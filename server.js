const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({
    server,
    perMessageDeflate: false // 圧縮を無効化
});

// 静的ファイルの提供
app.use(express.static('public'));

// WebSocket接続の管理
// 接続管理
let hosts = new Set();
let guests = new Set();
let currentPage = 1;
let currentPdfBuffer = null;

// クライアントの状態をチェック
function isClientConnected(ws) {
    return ws.readyState === WebSocket.OPEN;
}

// 接続中のクライアントの状態を出力
function logConnectionStatus() {
    console.log('接続状態:', {
        hosts: hosts.size,
        guests: guests.size,
        currentPdfLoaded: currentPdfBuffer !== null
    });
}

// WebSocketサーバー部分を修正
wss.on('connection', (ws, req) => {
    const clientIP = req.socket.remoteAddress;
    console.log(`新しいクライアント接続: ${clientIP}`);
    
    // 接続時の詳細情報を表示
    console.log('接続詳細:', {
        headers: req.headers,
        url: req.url,
        method: req.method,
        ip: clientIP
    });
    
    ws.on('message', (message) => {
        try {
            console.log('＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝');
            console.log(`メッセージ受信 (${clientIP}):`);
            
            // バイナリデータの場合（PDFファイルなど）
            if (Buffer.isBuffer(message)) {
                // バイナリデータをテキストに変換して確認
                const firstChars = message.toString('utf8', 0, 20);
                console.log(`バイナリデータ: ${message.length} bytes, 先頭: ${firstChars}`);
                
                // JSONらしき文字列（{で始まる）の場合は変換を試みる
                if (firstChars.startsWith('{')) {
                    try {
                        const jsonText = message.toString('utf8');
                        const data = JSON.parse(jsonText);
                        console.log('バイナリからJSONに変換:', data);
                        
                        // pingメッセージの処理
                        if (data.type === 'ping') {
                            console.log('Pingを受信しました、Pongを送信します');
                            ws.send(JSON.stringify({
                                type: 'pong',
                                timestamp: data.timestamp,
                                serverTime: Date.now()
                            }));
                            return;
                        }
                        
                        // テストメッセージの処理
                        if (data.type === 'test') {
                            console.log('テストメッセージを受信、応答を送信します');
                            ws.send(JSON.stringify({
                                type: 'test_response',
                                originalMessage: data.message,
                                receivedTimestamp: data.timestamp,
                                responseTimestamp: Date.now()
                            }));
                            return;
                        }
                        
                        // ★★★ registerメッセージの処理を追加 ★★★
                        if (data.type === 'register') {
                            console.log(`クライアント登録: ${data.role}, 現在の既存ロール: ${ws.role || 'なし'}`);
                            
                            // ロールの重複チェック
                            if (data.role === 'host') {
                                hosts.add(ws);
                                ws.role = 'host';
                                console.log('ホスト登録完了 - 現在のホスト数:', hosts.size);
                            } else {
                                guests.add(ws);
                                ws.role = 'guest';
                                console.log('ゲスト登録完了 - 現在のゲスト数:', guests.size);
                                
                                // 新しいゲストに現在のPDFとページを送信
                                if (currentPdfBuffer) {
                                    console.log('新規ゲストにPDFを送信:', currentPdfBuffer.length, 'bytes');
                                    try {
                                        // 送信前にWebSocket接続状態を確認
                                        if (ws.readyState === WebSocket.OPEN) {
                                            ws.send(currentPdfBuffer, { 
                                                binary: true,
                                                compress: false
                                            }, (error) => {
                                                if (error) {
                                                    console.error('新規ゲストへのPDF送信に失敗:', error);
                                                } else {
                                                    console.log('★★★ 新規ゲストへのPDF送信成功');
                                                    // ページ情報も送信
                                                    ws.send(JSON.stringify({ type: 'page', page: currentPage }));
                                                }
                                            });
                                        } else {
                                            console.error('新規ゲストのWebSocket接続が開いていません:', ws.readyState);
                                        }
                                    } catch (error) {
                                        console.error('新規ゲストへのPDF送信中にエラーが発生:', error);
                                    }
                                } else {
                                    console.log('現在PDFは設定されていません');
                                }
                                
                                // ページ情報のみ送信
                                ws.send(JSON.stringify({ 
                                    type: 'page', 
                                    page: currentPage
                                }));
                            }
                            
                            // 接続状況ログ出力
                            logConnectionStatus();
                            return;
                        }
                        
                        // ページ変更メッセージの処理
                        if (data.type === 'page' && ws.role === 'host') {
                            currentPage = data.page;
                            console.log('Page changed to:', currentPage);
                            // ゲストに新しいページを通知
                            guests.forEach(guest => {
                                if (guest.readyState === WebSocket.OPEN) {
                                    guest.send(JSON.stringify({ type: 'page', page: currentPage }));
                                }
                            });
                            return;
                        }

                        // デバッグ情報リクエストの処理
                        if (data.type === 'debug_request') {
                            console.log('デバッグ情報リクエストを受信:', data);
                            
                            // サーバーの状態情報を収集
                            const debugInfo = {
                                type: 'debug_response',
                                serverTime: new Date().toISOString(),
                                connections: {
                                    hosts: Array.from(hosts).map(h => ({
                                        readyState: h.readyState,
                                        role: h.role
                                    })),
                                    guests: Array.from(guests).map(g => ({
                                        readyState: g.readyState,
                                        role: g.role
                                    })),
                                    totalHosts: hosts.size,
                                    totalGuests: guests.size
                                },
                                currentPage: currentPage,
                                hasPdf: currentPdfBuffer !== null,
                                pdfSize: currentPdfBuffer ? currentPdfBuffer.length : 0,
                                clientInfo: data.clientInfo
                            };
                            
                            // デバッグ情報をログに出力
                            console.log('デバッグ情報を返信:', JSON.stringify(debugInfo, null, 2));
                            
                            // クライアントに返信
                            ws.send(JSON.stringify(debugInfo));
                            return;
                        }
                        
                    } catch (e) {
                        console.log('JSONパース失敗:', e.message);
                    }
                }
                
                // PDFファイルの場合の処理（既存コードをそのまま維持）
                // PDFファイルの場合（%PDFで始まるデータ）
                if (firstChars.startsWith('%PDF')) {
                    console.log('PDFファイルを検出しました');
                    
                    // ロールチェックを強化
                    if (!ws.role) {
                        console.log('未登録クライアントからのPDFアップロード');
                        // 未登録の場合はホストとして登録
                        hosts.add(ws);
                        ws.role = 'host';
                        console.log('ホストとして自動登録しました');
                    }
                    
                    if (ws.role === 'host') {
                        console.log('★★★ ホストからPDFを受信:', message.length, 'bytes');
                        // バッファをスライスして新しいバッファを作成
                        currentPdfBuffer = Buffer.alloc(message.length);
                        message.copy(currentPdfBuffer);
                        console.log('PDFバッファを作成:', currentPdfBuffer.length, 'bytes');
                        
                        // アクティブなゲストの数を確認
                        const activeGuests = Array.from(guests).filter(guest => isClientConnected(guest));
                        console.log('アクティブなゲスト数:', activeGuests.length);
                        
                        // デバッグ情報を追加
                        console.log('guests集合の内容:', 
                            Array.from(guests).map(g => ({ 
                                readyState: g.readyState,
                                role: g.role,
                                isConnected: isClientConnected(g)
                            }))
                        );
                        
                        // 全てのゲストにPDFを送信
                        let successCount = 0;
                        let failCount = 0;
                        
                        if (activeGuests.length === 0) {
                            console.log('アクティブなゲストがいません。PDFは後で新規ゲストに送信されます。');
                            return;
                        }
                        
                        console.log('ゲストへのPDF送信を開始します...');
                        
                        // 接続中のゲストのみに送信
                        for (const guest of activeGuests) {
                            try {
                                console.log(`ゲストにPDFを送信開始 (${currentPdfBuffer.length} bytes)`);
                                
                                // バッファを一度に送信
                                guest.send(currentPdfBuffer, {
                                    binary: true,
                                    compress: false // 圧縮を無効化
                                }, (error) => {
                                    if (error) {
                                        console.error('ゲストへのPDF送信に失敗:', error);
                                        failCount++;
                                        guests.delete(guest);
                                    } else {
                                        console.log('★★★ ゲストへのPDF送信成功');
                                        successCount++;
                                    }
                                    
                                    console.log(`現在の進捗: 成功=${successCount}, 失敗=${failCount}, 総数=${activeGuests.length}`);
                                });
                            } catch (error) {
                                console.error('ゲストへのPDF送信中にエラーが発生:', error);
                                failCount++;
                                guests.delete(guest);
                            }
                        }
                        
                        return;
                    } else {
                        console.log('ゲストからのPDFアップロード - 無視します');
                    }
                }
            }
            else {
                // テキストメッセージ（こちらには来ないかもしれない）
                console.log('テキストメッセージ:', message);
                try {
                    const data = JSON.parse(message);
                    console.log('JSONデータ:', data);
                    // 同じ処理を実装
                    if (data.type === 'ping') {
                        console.log('Ping received, sending pong');
                        ws.send(JSON.stringify({
                            type: 'pong',
                            timestamp: data.timestamp,
                            serverTime: Date.now()
                        }));
                        return;
                    }

                    // テストメッセージ応答を追加
                    if (data.type === 'test') {
                        console.log('Test message received, sending response');
                        ws.send(JSON.stringify({
                            type: 'test_response',
                            originalMessage: data.message,
                            receivedTimestamp: data.timestamp,
                            responseTimestamp: Date.now()
                        }));
                        return;
                    }
                    
                    if (data.type === 'register') {
                        console.log(`クライアント登録: ${data.role}, 現在の既存ロール: ${ws.role || 'なし'}`);
                        
                        // ロールの重複チェック
                        if (data.role === 'host') {
                            hosts.add(ws);
                            ws.role = 'host';
                            console.log('ホスト登録完了 - 現在のホスト数:', hosts.size);
                        } else {
                            guests.add(ws);
                            ws.role = 'guest';
                            console.log('ゲスト登録完了 - 現在のゲスト数:', guests.size);
                            
                            // 新しいゲストに現在のPDFとページを送信
                            if (currentPdfBuffer) {
                                console.log('新規ゲストにPDFを送信:', currentPdfBuffer.length, 'bytes');
                                try {
                                    // 送信前にWebSocket接続状態を確認
                                    if (ws.readyState === WebSocket.OPEN) {
                                        ws.send(currentPdfBuffer, { 
                                            binary: true,
                                            compress: false
                                        }, (error) => {
                                            if (error) {
                                                console.error('新規ゲストへのPDF送信に失敗:', error);
                                            } else {
                                                console.log('★★★ 新規ゲストへのPDF送信成功');
                                                // ページ情報も送信
                                                ws.send(JSON.stringify({ type: 'page', page: currentPage }));
                                            }
                                        });
                                    } else {
                                        console.error('新規ゲストのWebSocket接続が開いていません:', ws.readyState);
                                    }
                                } catch (error) {
                                    console.error('新規ゲストへのPDF送信中にエラーが発生:', error);
                                }
                            } else {
                                console.log('現在PDFは設定されていません');
                            }
                            
                            // ページ情報のみ送信
                            ws.send(JSON.stringify({ 
                                type: 'page', 
                                page: currentPage
                            }));
                        }
                        
                        // 接続状況ログ出力
                        logConnectionStatus();
                        return;
                    } else if (data.type === 'page' && ws.role === 'host') {
                        currentPage = data.page;
                        console.log('Page changed to:', currentPage);
                        // ゲストに新しいページを通知
                        guests.forEach(guest => {
                            guest.send(JSON.stringify({ type: 'page', page: currentPage }));
                        });
                    } else if (data.type === 'debug_request') {
                        console.log('デバッグ情報リクエストを受信:', data);
                        
                        // サーバーの状態情報を収集
                        const debugInfo = {
                            type: 'debug_response',
                            serverTime: new Date().toISOString(),
                            connections: {
                                hosts: Array.from(hosts).map(h => ({
                                    readyState: h.readyState,
                                    role: h.role
                                })),
                                guests: Array.from(guests).map(g => ({
                                    readyState: g.readyState,
                                    role: g.role
                                })),
                                totalHosts: hosts.size,
                                totalGuests: guests.size
                            },
                            currentPage: currentPage,
                            hasPdf: currentPdfBuffer !== null,
                            pdfSize: currentPdfBuffer ? currentPdfBuffer.length : 0,
                            clientInfo: data.clientInfo
                        };
                        
                        // デバッグ情報をログに出力
                        console.log('デバッグ情報を返信:', JSON.stringify(debugInfo, null, 2));
                        
                        // クライアントに返信
                        ws.send(JSON.stringify(debugInfo));
                        return;
                    }
                } catch (e) {
                    console.error('JSONパースエラー:', e);
                }
            }
            console.log('＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝');
        } catch (error) {
            console.error('メッセージ処理エラー:', error);
        }
    });
    
    // 接続エラー処理
    ws.on('error', (error) => {
        console.error(`WebSocketエラー (${clientIP}):`, error);
    });
    
    // 切断ログ
    ws.on('close', (code, reason) => {
        console.log(`クライアント切断 (${clientIP}): コード=${code}, 理由=${reason || '理由なし'}`);
    });

    // クライアントの切断処理
    ws.on('close', () => {
        console.log('クライアントが切断:', ws.role);
        if (ws.role === 'host') {
            hosts.delete(ws);
            console.log('ホストが切断されました');
        } else {
            guests.delete(ws);
            console.log('ゲストが切断されました');
        }
        logConnectionStatus();
    });

    // エラー処理
    ws.on('error', (error) => {
        console.error('WebSocketエラー:', error);
        // エラーが発生したクライアントを削除
        if (ws.role === 'host') {
            hosts.delete(ws);
        } else {
            guests.delete(ws);
        }
        logConnectionStatus();
    });

    // 定期的な接続チェック
    const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
            try {
                ws.ping();
            } catch (error) {
                console.error('Pingエラー:', error);
                clearInterval(pingInterval);
                ws.terminate();
            }
        } else {
            clearInterval(pingInterval);
        }
    }, 30000); // 30秒ごとにping

    // クリーンアップ
    ws.on('close', () => {
        clearInterval(pingInterval);
    });
});

// メインページの提供
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});