const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

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

// セッション管理のためのマップ
const sessions = new Map();

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
                    
                    // セッションチェック
                    if (!ws.sessionId) {
                        console.log('セッションIDなしでPDFアップロード - 拒否します');
                        ws.send(JSON.stringify({
                            type: 'session_error',
                            message: 'セッションが作成されていません'
                        }));
                        return;
                    }
                    
                    // PDFバッファの処理
                    console.log(`★★★ セッション ${ws.sessionId} のPDFを受信:`, message.length, 'bytes');
                    
                    // セッション情報を更新
                    const sessionInfo = sessions.get(ws.sessionId);
                    if (sessionInfo) {
                        // PDFデータを保存
                        sessionInfo.pdfBuffer = Buffer.from(message);
                        
                        // 接続中のゲストに送信
                        const activeGuests = Array.from(sessionInfo.guests).filter(guest => 
                            guest.readyState === WebSocket.OPEN
                        );
                        
                        console.log(`セッション ${ws.sessionId} のゲスト数:`, activeGuests.length);
                        
                        for (const guest of activeGuests) {
                            try {
                                console.log(`ゲストにPDFを送信開始 (${message.length} bytes)`);
                                guest.send(message);
                                console.log('ゲストへのPDF送信完了');
                            } catch (error) {
                                console.error('ゲストへのPDF送信失敗:', error);
                            }
                        }
                    }
                    return;
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
    
    ws.on('message', (message) => {
        try {
            console.log('＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝');
            console.log(`メッセージ受信 (${clientIP}):`);
            
            // バイナリデータの場合
            if (Buffer.isBuffer(message)) {
                // バイナリデータをテキストに変換して確認
                const firstChars = message.toString('utf8', 0, 20);
                console.log(`バイナリデータ: ${message.length} bytes, 先頭: ${firstChars}`);
                
                // JSONらしき文字列（{で始まる）の場合は変換を試みる
                if (firstChars.startsWith('{')) {
                    // 既存の処理...
                }
                
                // PDFファイルの場合
                if (firstChars.startsWith('%PDF')) {
                    console.log('PDFファイルを検出しました');
                    
                    // セッションチェック
                    if (!ws.sessionId) {
                        console.log('セッションIDなしでPDFアップロード - 拒否します');
                        ws.send(JSON.stringify({
                            type: 'session_error',
                            message: 'セッションが作成されていません'
                        }));
                        return;
                    }
                    
                    // PDFバッファの処理
                    console.log(`★★★ セッション ${ws.sessionId} のPDFを受信:`, message.length, 'bytes');
                    
                    // セッション情報を更新
                    const sessionInfo = sessions.get(ws.sessionId);
                    if (sessionInfo) {
                        // PDFデータを保存
                        sessionInfo.pdfBuffer = Buffer.from(message);
                        
                        // 接続中のゲストに送信
                        const activeGuests = Array.from(sessionInfo.guests).filter(guest => 
                            guest.readyState === WebSocket.OPEN
                        );
                        
                        console.log(`セッション ${ws.sessionId} のゲスト数:`, activeGuests.length);
                        
                        for (const guest of activeGuests) {
                            try {
                                console.log(`ゲストにPDFを送信開始 (${message.length} bytes)`);
                                guest.send(message);
                                console.log('ゲストへのPDF送信完了');
                            } catch (error) {
                                console.error('ゲストへのPDF送信失敗:', error);
                            }
                        }
                    }
                    return;
                }
            }
            
            // JSONメッセージの場合（テキストまたはバイナリ）
            try {
                const jsonText = Buffer.isBuffer(message) 
                    ? message.toString('utf8') 
                    : message;
                
                const data = JSON.parse(jsonText);
                console.log('JSONデータ:', data);
                
                // セッション作成リクエスト
                if (data.type === 'create_session') {
                    console.log('セッション作成リクエスト:', data);
                    
                    // すでにセッションを持っている場合は再利用
                    if (ws.sessionId && sessions.has(ws.sessionId)) {
                        console.log(`既存セッション ${ws.sessionId} を再利用`);
                        ws.send(JSON.stringify({
                            type: 'session_created',
                            sessionId: ws.sessionId
                        }));
                        return;
                    }
                    
                    // 新しいセッションIDを生成
                    const sessionId = uuidv4();
                    console.log('新規セッション作成:', sessionId);
                    
                    // セッション情報を保存
                    sessions.set(sessionId, {
                        host: ws,
                        guests: new Set(),
                        pdfBuffer: null,
                        currentPage: 1,
                        createdAt: Date.now(),
                        fileInfo: {
                            name: data.fileName || 'untitled.pdf',
                            size: data.fileSize || 0
                        }
                    });
                    
                    // クライアントにセッションIDを設定
                    ws.sessionId = sessionId;
                    ws.role = 'host';
                    
                    // セッション作成完了をクライアントに通知
                    ws.send(JSON.stringify({
                        type: 'session_created',
                        sessionId: sessionId
                    }));
                    
                    // ホスト集合からいったん削除（セッションベースで管理するため）
                    hosts.delete(ws);
                    return;
                }
                
                // クライアント登録（ロール指定）
                if (data.type === 'register') {
                    console.log('クライアント登録:', data);
                    
                    if (data.role === 'host') {
                        // ホストとして登録
                        ws.role = 'host';
                        hosts.add(ws);
                        console.log('ホスト登録完了');
                    } 
                    else if (data.role === 'guest' && data.sessionId) {
                        // 既存セッションにゲストとして参加
                        const sessionId = data.sessionId;
                        console.log(`セッション ${sessionId} にゲストとして参加を試行`);
                        
                        if (sessions.has(sessionId)) {
                            const sessionInfo = sessions.get(sessionId);
                            ws.sessionId = sessionId;
                            ws.role = 'guest';
                            sessionInfo.guests.add(ws);
                            console.log(`セッション ${sessionId} にゲスト追加成功`);
                            
                            // 既存のPDFがあればゲストに送信
                            if (sessionInfo.pdfBuffer) {
                                console.log(`新しいゲストにPDFを送信 (${sessionInfo.pdfBuffer.length} bytes)`);
                                try {
                                    ws.send(sessionInfo.pdfBuffer);
                                    
                                    // 現在のページ情報も送信
                                    ws.send(JSON.stringify({
                                        type: 'page',
                                        page: sessionInfo.currentPage
                                    }));
                                } catch (error) {
                                    console.error('ゲストへのPDF送信エラー:', error);
                                }
                            }
                            
                            ws.send(JSON.stringify({
                                type: 'session_joined',
                                sessionId: sessionId,
                                message: 'セッションに参加しました'
                            }));
                        } else {
                            console.log(`セッション ${sessionId} が存在しません`);
                            ws.send(JSON.stringify({
                                type: 'session_error',
                                message: 'セッションが存在しないか、既に終了しています'
                            }));
                        }
                    }
                    else {
                        // 通常のゲスト登録（既存の方法、後方互換性のため）
                        ws.role = 'guest';
                        guests.add(ws);
                        console.log('従来型のゲスト登録完了');
                    }
                    return;
                }
                
                // ページ変更メッセージ
                if (data.type === 'page') {
                    const newPage = data.page;
                    console.log('ページ変更:', newPage);
                    
                    // セッションベースの処理
                    if (ws.sessionId && sessions.has(ws.sessionId)) {
                        const sessionInfo = sessions.get(ws.sessionId);
                        sessionInfo.currentPage = newPage;
                        
                        // そのセッションのゲストにのみ通知
                        for (const guest of sessionInfo.guests) {
                            if (guest.readyState === WebSocket.OPEN) {
                                guest.send(JSON.stringify({
                                    type: 'page',
                                    page: newPage
                                }));
                            }
                        }
                    }
                    // 従来型の処理（後方互換性用）
                    else if (ws.role === 'host') {
                        currentPage = newPage;
                        guests.forEach(guest => {
                            if (guest.readyState === WebSocket.OPEN) {
                                guest.send(JSON.stringify({
                                    type: 'page', 
                                    page: newPage
                                }));
                            }
                        });
                    }
                    return;
                }
                
                // ゲストからのページリクエスト処理を追加
                if (data.type === 'page_request') {
                    console.log('ページリクエスト:', data);
                    
                    // セッションベースの処理
                    if (ws.sessionId && sessions.has(ws.sessionId)) {
                        const sessionInfo = sessions.get(ws.sessionId);
                        let currentPage = sessionInfo.currentPage || 1;
                        
                        if (data.action === 'prev' && currentPage > 1) {
                            currentPage--;
                            console.log(`ゲストリクエストによりページを戻します: ${currentPage}`);
                        }
                        else if (data.action === 'next') {
                            // 最大ページ数がわからないため、前進は常に許可
                            currentPage++;
                            console.log(`ゲストリクエストによりページを進めます: ${currentPage}`);
                        }
                        
                        // ホストに通知
                        if (sessionInfo.host && sessionInfo.host.readyState === WebSocket.OPEN) {
                            sessionInfo.host.send(JSON.stringify({
                                type: 'guest_page_request',
                                page: currentPage,
                                action: data.action,
                                originalPage: data.currentPage
                            }));
                        }
                        
                        // ページ情報を保存
                        sessionInfo.lastGuestRequest = {
                            page: currentPage,
                            time: Date.now()
                        };
                    }
                    return;
                }
                
                // その他の既存メッセージ処理...
                
            } catch (jsonError) {
                console.error('JSONパースエラー:', jsonError);
            }
        } catch (error) {
            console.error('メッセージ処理エラー:', error);
        }
    });
    
    // 切断時の処理
    ws.on('close', (code, reason) => {
        console.log(`クライアント切断 (${clientIP}): コード=${code}, 理由=${reason || '理由なし'}`);
        
        // セッションベースの切断処理
        if (ws.sessionId && sessions.has(ws.sessionId)) {
            const sessionInfo = sessions.get(ws.sessionId);
            
            // ホストが切断した場合
            if (ws.role === 'host' && sessionInfo.host === ws) {
                console.log(`セッション ${ws.sessionId} のホストが切断しました`);
                
                // ホストが切断してもセッションを維持する（設定可能）
                const keepSessionAlive = true;
                
                if (!keepSessionAlive) {
                    // セッションのゲストに通知
                    for (const guest of sessionInfo.guests) {
                        if (guest.readyState === WebSocket.OPEN) {
                            guest.send(JSON.stringify({
                                type: 'session_closed',
                                message: 'ホストが切断したためセッションが終了しました'
                            }));
                        }
                    }
                    
                    // セッションを削除
                    sessions.delete(ws.sessionId);
                    console.log(`セッション ${ws.sessionId} を削除しました`);
                } else {
                    console.log(`セッション ${ws.sessionId} は維持されます（ホストが再接続可能）`);
                }
            }
            // ゲストが切断した場合
            else if (ws.role === 'guest') {
                sessionInfo.guests.delete(ws);
                console.log(`セッション ${ws.sessionId} からゲストが切断しました。残りゲスト数: ${sessionInfo.guests.size}`);
            }
        }
        
        // 従来の処理（後方互換性用）
        if (ws.role === 'host') {
            hosts.delete(ws);
            console.log('ホストが切断されました');
        } else if (ws.role === 'guest') {
            guests.delete(ws);
            console.log('ゲストが切断されました');
        }
        
        logConnectionStatus();
    });
});

// 古いセッションをクリーンアップするバックグラウンドタスク
setInterval(() => {
    const now = Date.now();
    const SESSION_TIMEOUT = 2 * 60 * 60 * 1000; // 2時間
    
    for (const [sessionId, sessionInfo] of sessions.entries()) {
        // ホストが切断済みかつ2時間以上経過したセッションを削除
        if (
            sessionInfo.host.readyState !== WebSocket.OPEN &&
            now - sessionInfo.createdAt > SESSION_TIMEOUT
        ) {
            console.log(`古いセッション ${sessionId} を削除します`);
            sessions.delete(sessionId);
        }
    }
}, 30 * 60 * 1000); // 30分ごとにチェック

// メインページの提供
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});