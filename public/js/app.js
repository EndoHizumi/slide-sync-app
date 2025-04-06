// PDF.js の設定
console.log('PDF.js の初期化を開始');
if (typeof pdfjsLib === 'undefined') {
    console.error('PDF.js ライブラリが読み込まれていません');
    alert('PDF.js ライブラリの読み込みに失敗しました');
}
// PDF.jsワーカーファイルの設定
if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
    console.log('PDF.jsワーカーファイルのパスを設定:', pdfjsLib.GlobalWorkerOptions.workerSrc);
} else {
    console.log('PDF.jsワーカーファイルは既に設定されています:', pdfjsLib.GlobalWorkerOptions.workerSrc);
}

let pdfDoc = null;
let pageNum = 1;
let ws = null;
let isHost = true; // デフォルトはホスト
let sessionId = null;
let currentPdfUrl = null;
let currentPdfData = null; // PDFデータを保存する変数

// DOM要素
const canvas = document.getElementById('pdfViewer');
const ctx = canvas.getContext('2d');
const roleSelect = document.getElementById('roleSelect');
const fileInput = document.getElementById('pdfFile');
let prevButton = document.getElementById('prevPage');
let nextButton = document.getElementById('nextPage');
const currentPageSpan = document.getElementById('currentPage');
const totalPagesSpan = document.getElementById('totalPages');
const statusDiv = document.createElement('div');
statusDiv.className = 'status';
document.querySelector('.controls').appendChild(statusDiv);

// WebSocket接続の状態管理
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_INTERVAL = 3000;
let isReconnecting = false;

// URLからセッションIDを取得する関数
function getSessionIdFromUrl() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('session');
}

// 初期化時にURLパラメータを確認
function initializeRole() {
    const urlSessionId = getSessionIdFromUrl();
    
    if (urlSessionId) {
        // セッションIDがURLに含まれている場合はゲスト
        isHost = false;
        sessionId = urlSessionId;
        console.log(`ゲストモードで初期化: セッションID=${sessionId}`);
        
        // ゲストモード用のUI設定
        setupGuestMode();
    } else {
        // セッションIDがない場合はホスト
        isHost = true;
        sessionId = null;
        console.log('ホストモードで初期化: 新規セッション');
        
        // ホストモード用のUI設定
        setupHostMode();
    }
}

// ゲストモード用のUI設定
function setupGuestMode() {
    // bodyにゲストモードクラスを追加
    document.body.classList.add('guest-mode');
    
    // 全画面表示を自動的に有効化
    const viewer = document.getElementById('viewer');
    if (viewer) {
        viewer.classList.add('fullscreen');
    }
    
    // ゲスト情報表示を有効化
    const guestInfo = document.getElementById('guestInfo');
    if (guestInfo) {
        guestInfo.style.display = 'flex';
    }
    
    // 接続状態の初期表示
    updateConnectionStatus('connecting');
    
    // ページ情報の初期表示
    document.getElementById('guestCurrentPage').textContent = '0';
    document.getElementById('guestTotalPages').textContent = '0';
    
    console.log('ゲストモードUIを設定しました');
}

// ホストモード用のUI設定
function setupHostMode() {
    // ゲストモードクラスを削除
    document.body.classList.remove('guest-mode');
    
    // ホストヘッダーを表示
    const hostHeader = document.getElementById('hostHeader');
    if (hostHeader) {
        hostHeader.style.display = 'block';
    }
    
    // 共有URL表示エリアを非表示に
    const shareUrlArea = document.getElementById('shareUrlArea');
    if (shareUrlArea) {
        shareUrlArea.style.display = 'none';
    }
    
    // ロール表示を更新
    const roleText = document.getElementById('roleText');
    const roleDisplay = document.getElementById('roleDisplay');
    if (roleText && roleDisplay) {
        roleText.textContent = 'ホストモード';
        roleDisplay.className = 'role-display host';
    }

    // ナビゲーションボタンを有効化（追加）
    if (pdfDoc) {
        prevButton.disabled = pageNum <= 1;
        nextButton.disabled = pageNum >= pdfDoc.numPages;
        console.log('ナビゲーションボタンを有効化しました');
    }
    
    console.log('ホストモードUIを設定しました');
}

// 接続状態の更新
function updateConnectionStatus(status) {
    const connectionDot = document.getElementById('connectionDot');
    if (!connectionDot) return;
    
    // 既存のクラスをクリア
    connectionDot.className = '';
    
    switch(status) {
        case 'connected':
            connectionDot.classList.add('connected');
            break;
        case 'disconnected':
            connectionDot.classList.add('disconnected');
            break;
        case 'connecting':
            connectionDot.classList.add('connecting');
            break;
    }
}

// ロールに基づいてUI要素を更新
function updateUIBasedOnRole() {
    // ロールセレクト（後で削除）を非表示に
    const roleSelect = document.getElementById('roleSelect');
    if (roleSelect) roleSelect.style.display = 'none';
    
    fileInput.disabled = !isHost;
    prevButton.disabled = !isHost || !pdfDoc;
    nextButton.disabled = !isHost || !pdfDoc;
    
    // ホストの場合、共有URLを表示するエリアを作成
    if (isHost) {
        // 既存のURLエリアがあれば削除
        const existingUrlArea = document.getElementById('shareUrlArea');
        if (existingUrlArea) existingUrlArea.remove();
        
        // 新しいURLエリアを作成
        const shareUrlArea = document.createElement('div');
        shareUrlArea.id = 'shareUrlArea';
        shareUrlArea.className = 'shareUrlArea';
        shareUrlArea.innerHTML = `
            <span>セッション未作成</span>
            <button id="copyUrlBtn" disabled>URLをコピー</button>
        `;
        document.querySelector('.controls').appendChild(shareUrlArea);
        
        // コピーボタンのイベント設定
        document.getElementById('copyUrlBtn').addEventListener('click', copyShareUrl);
        
        statusDiv.textContent = 'ホストモード - PDFをアップロードしてセッションを開始してください';
    } else {
        statusDiv.textContent = `ゲストモード - セッション ${sessionId} に接続しています`;
    }
    
    // 全画面モード中の場合、クラスを更新
    if (isFullscreen) {
        if (isHost) {
            pdfViewer.classList.remove('guest');
        } else {
            pdfViewer.classList.add('guest');
        }
    }
}

// 共有URLをコピーする関数
function copyShareUrl() {
    if (!sessionId) return;
    
    const shareUrl = `${window.location.origin}${window.location.pathname}?session=${sessionId}`;
    navigator.clipboard.writeText(shareUrl)
        .then(() => {
            alert('共有URLをクリップボードにコピーしました');
        })
        .catch(err => {
            console.error('URLのコピーに失敗:', err);
            // フォールバック: テキストエリアを使用
            const textArea = document.createElement('textarea');
            textArea.value = shareUrl;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            alert('共有URLをクリップボードにコピーしました');
        });
}

// WebSocket接続の初期化
function initWebSocket() {
    console.log('WebSocket初期化開始');
    
    if (isReconnecting) {
        console.log('既に再接続処理中です');
        return;
    }

    if (ws && ws.readyState === WebSocket.OPEN) {
        console.log('WebSocket接続は既に確立されています');
        
        // 既存の接続でも、念のため再登録を行う
        const registerMsg = {
            type: 'register',
            role: isHost ? 'host' : 'guest'
        };
        
        // セッションIDがある場合、それも送信
        if (sessionId) {
            registerMsg.sessionId = sessionId;
        }
        
        console.log('再登録メッセージ送信:', registerMsg);
        sendSecureMessage(registerMsg);
        return;
    }

    isReconnecting = true;
    console.log(`WebSocket接続を試行: wss://${window.location.host}`);
    ws = new WebSocket(`wss://${window.location.host}`);
    ws.binaryType = 'blob'; // blobとして受信
    console.log('WebSocketオブジェクト作成完了、イベントハンドラを設定します');

    ws.onopen = () => {
        console.log('WebSocket接続確立 - onopen発生');
        statusDiv.textContent = '接続済み';
        reconnectAttempts = 0;
        isReconnecting = false;

        // 接続確立後に登録メッセージを送信（セッションIDを含む）
        const registerMsg = {
            type: 'register',
            role: isHost ? 'host' : 'guest'
        };
        
        // セッションIDがある場合、それも送信
        if (sessionId) {
            registerMsg.sessionId = sessionId;
        }
        
        console.log('登録メッセージ送信:', registerMsg);
        sendSecureMessage(registerMsg);
        
        // ホストの場合、現在のPDFを再送する
        if (isHost && currentPdfData) {
            console.log('再接続後にPDFを再送信します');
            setTimeout(() => {
                ws.send(currentPdfData);
            }, 1000); // 1秒待ってから送信
        }
        
        // 接続状態の定期チェックを追加
        // setInterval(() => {
        //     console.log('WebSocket接続状態:', ws.readyState);
        //     if (ws.readyState === WebSocket.OPEN) {
        //         // 接続テスト用のpingを送信
        //         ws.send(JSON.stringify({type: 'ping', timestamp: Date.now()}));
        //     }
        // }, 10000); // 10秒ごとにチェック
    };

    // onmessageイベントの強化
    ws.onmessage = async (event) => {
        console.log('WebSocketメッセージ受信イベント発生 - onmessage');
        console.log('受信データ詳細:', {
            type: typeof event.data,
            isArrayBuffer: event.data instanceof ArrayBuffer,
            isBlob: event.data instanceof Blob,
            isString: typeof event.data === 'string',
            length: event.data.length || event.data.size || event.data.byteLength || '不明',
            sample: typeof event.data === 'string' ? event.data.substring(0, 50) + '...' : '非テキストデータ'
        });

        try {
            console.log('WebSocketメッセージを受信:', {
                type: typeof event.data,
                isArrayBuffer: event.data instanceof ArrayBuffer,
                isBlob: event.data instanceof Blob,
                length: event.data.length || event.data.byteLength
            });

            // バイナリデータの場合
            if (event.data instanceof Blob) {
                if (!isHost) {
                    try {
                        console.log('Blobデータを受信:', event.data.size, 'bytes');
                        statusDiv.textContent = 'PDFデータを受信中...';

                        // BlobをArrayBufferに変換
                        const arrayBuffer = await event.data.arrayBuffer();
                        console.log('BlobをArrayBufferに変換:', arrayBuffer.byteLength, 'bytes');

                        // ArrayBufferをUint8Arrayに変換
                        const pdfData = new Uint8Array(arrayBuffer);
                        console.log('ArrayBufferをUint8Arrayに変換:', pdfData.length, 'bytes');

                        // データの整合性チェック
                        if (pdfData.length === 0) {
                            throw new Error('受信したPDFデータが空です');
                        }

                        // PDFシグネチャのチェック (%PDF-)
                        const signature = String.fromCharCode.apply(null, pdfData.slice(0, 5));
                        if (signature !== '%PDF-') {
                            console.error('PDFシグネチャ:', signature);
                            throw new Error('受信したデータはPDFファイルではありません');
                        }

                        console.log('PDFシグネチャを確認:', signature);

                        // PDF.jsでドキュメントを読み込み
                        statusDiv.textContent = 'PDFを読み込み中...';
                        console.log('PDF.jsでドキュメントを読み込み開始');
                        
                        const loadingTask = pdfjsLib.getDocument({ data: pdfData });
                        loadingTask.onProgress = (progress) => {
                            const percent = Math.round((progress.loaded / progress.total) * 100);
                            console.log(`PDF読み込み進捗: ${percent}%`);
                            statusDiv.textContent = `PDFを読み込み中... ${percent}%`;
                        };
                        
                        pdfDoc = await loadingTask.promise;
                        console.log('PDFドキュメントを読み込み完了。総ページ数:', pdfDoc.numPages);
                        
                        totalPagesSpan.textContent = pdfDoc.numPages;
                        renderPage(1);
                        statusDiv.textContent = 'PDF読み込み完了';
                    } catch (error) {
                        console.error('PDFデータの処理中にエラーが発生:', error);
                        console.error('エラーの詳細:', error.stack);
                        statusDiv.textContent = `PDFの読み込みに失敗: ${error.message}`;
                        alert('PDFの読み込みに失敗しました: ' + error.message);
                    }
                }
                return;
            }

            // JSONメッセージの場合
            try {
                const data = JSON.parse(event.data);
                console.log('JSONメッセージを受信:', data);
                
                // pong応答の処理を追加
                if (data.type === 'pong') {
                    const latency = Date.now() - data.timestamp;
                    console.log(`WebSocketレイテンシ: ${latency}ms`);
                    statusDiv.textContent = `接続状態: 良好 (${latency}ms)`;
                    return;
                }
                
                // テスト応答の処理を追加
                if (data.type === 'test_response') {
                    const roundTrip = Date.now() - data.receivedTimestamp;
                    console.log(`テストメッセージ応答: ${roundTrip}ms`);
                    alert(`テスト成功! サーバーからの応答\n往復時間: ${roundTrip}ms\n元のメッセージ: ${data.originalMessage}`);
                    statusDiv.textContent = `テスト成功 (${roundTrip}ms)`;
                    return;
                }
                
                // セッション作成応答の処理
                if (data.type === 'session_created') {
                    sessionId = data.sessionId;
                    console.log('新しいセッションID:', sessionId);
                    
                    // 共有URL表示を更新
                    const shareUrlArea = document.getElementById('shareUrlArea');
                    if (shareUrlArea) {
                        const shareUrl = `${window.location.origin}${window.location.pathname}?session=${sessionId}`;
                        shareUrlArea.innerHTML = `
                            <input type="text" value="${shareUrl}" readonly>
                            <button id="copyUrlBtn">URLをコピー</button>
                        `;
                        // 表示設定を追加
                        shareUrlArea.style.display = 'block';
                        document.getElementById('copyUrlBtn').addEventListener('click', copyShareUrl);
                    }
                    
                    // PDFデータを送信
                    if (currentPdfData && ws.readyState === WebSocket.OPEN) {
                        console.log('セッション作成後にPDFデータを送信開始 -', currentPdfData.byteLength, 'バイト');
                        
                        try {
                            // 送信用にコピーを作成して送信
                            const dataToSend = currentPdfData.slice(0);
                            ws.send(dataToSend);
                            console.log('PDFデータ送信処理が完了しました');
                            
                            // この時点でPDF.jsでもレンダリングを開始（別のコピーを使用）
                            processPdfLocally(currentPdfData.slice(0));
                        } catch (error) {
                            console.error('PDFデータ送信中にエラーが発生しました:', error);
                            statusDiv.textContent = 'PDFデータの送信に失敗しました';
                        }
                    }
                    
                    statusDiv.textContent = 'セッション作成完了 - URLを共有してください';
                    return;
                }
                
                // セッションエラーの処理
                if (data.type === 'session_error') {
                    console.error('セッションエラー:', data.message);
                    statusDiv.textContent = `セッションエラー: ${data.message}`;
                    alert(`セッションエラー: ${data.message}`);
                    return;
                }
                
                if (data.type === 'page' && !isHost) {
                    pageNum = data.page;
                    renderPage(pageNum);
                }
                
                // ゲストモードでのページ更新処理
                if (!isHost && event.data instanceof Object) {
                    try {
                        const data = JSON.parse(event.data);
                        
                        // ページ変更メッセージ
                        if (data.type === 'page') {
                            const newPage = data.page;
                            
                            // ページ番号を更新
                            document.getElementById('guestCurrentPage').textContent = newPage;
                            
                            // PDFがロードされている場合はページも変更
                            if (pdfDoc && newPage !== pageNum) {
                                pageNum = newPage;
                                renderPage(pageNum);
                            }
                        }
                        
                        // セッション情報を更新
                        if (data.type === 'session_joined') {
                            console.log('セッションに参加しました:', data);
                            updateConnectionStatus('connected');
                        }
                        
                    } catch (e) {
                        console.error('JSONパースエラー:', e);
                    }
                }
            } catch (parseError) {
                console.error('JSONパースエラー:', parseError);
                console.log('受信したデータ:', event.data);
                statusDiv.textContent = 'メッセージの解析に失敗しました';
            }
        } catch (error) {
            console.error('メッセージ処理エラー:', error);
            console.error('エラーの詳細:', error.stack);
            statusDiv.textContent = `エラーが発生しました: ${error.message}`;
        }
    };

    ws.onclose = () => {
        console.log('WebSocket接続切断');
        updateConnectionStatus('disconnected');
        
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttempts++;
            statusDiv.textContent = `接続切断 - 再接続を試みています (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`;
            setTimeout(() => {
                console.log(`再接続を試みます (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
                initWebSocket();
            }, RECONNECT_INTERVAL);
        } else {
            statusDiv.textContent = '接続に失敗しました。ページを更新してください。';
            isReconnecting = false;
        }
    };

    ws.onerror = (error) => {
        console.error('WebSocket エラー:', error);
        statusDiv.textContent = '接続エラー';
        updateConnectionStatus('disconnected');
        if (ws.readyState === WebSocket.OPEN) {
            ws.close();
        }
    };
}

// PDFの読み込みと送信（ホスト用）
async function loadPDF(file) {
    try {
        console.log('PDFファイルの読み込みを開始:', file.name);
        statusDiv.textContent = 'PDFを読み込み中...';
        
        const arrayBuffer = await file.arrayBuffer();
        console.log('PDFファイルをArrayBufferに変換:', arrayBuffer.byteLength, 'bytes');
        
        // PDFシグネチャのチェック (%PDF-)
        const firstBytes = new Uint8Array(arrayBuffer.slice(0, 5));
        const signature = String.fromCharCode.apply(null, firstBytes);
        if (signature !== '%PDF-') {
            throw new Error('選択されたファイルはPDFではありません');
        }
        
        // PDFデータをグローバル変数に保存（再接続時のために）
        currentPdfData = arrayBuffer.slice(0);
        
        // ホストの場合、PDFのバイナリデータを直接送信
        if (isHost && ws && ws.readyState === WebSocket.OPEN) {
            console.log('WebSocketでPDFデータを送信準備');
            
            // PDFデータ送信前にセッション作成メッセージを送る
            if (!sessionId) {
                sendSecureMessage({
                    type: 'create_session',
                    fileName: file.name,
                    fileSize: file.size,
                });
                
                statusDiv.textContent = 'セッション作成中...';
                return;
            } else {
                // 既にセッションIDがある場合は直接送信
                console.log('既存セッションにPDFを送信:', arrayBuffer.byteLength, 'バイト');
                ws.send(arrayBuffer);
                console.log('PDFデータ送信完了');
            }
        }

        // ローカルでもPDFを処理（セッション作成前でもUIに表示するため）
        await processPdfLocally(arrayBuffer);
        
    } catch (error) {
        console.error('PDF読み込みエラー:', error);
        console.error('エラーの詳細:', error.stack);
        statusDiv.textContent = `PDF読み込みエラー: ${error.message}`;
        alert('PDFの読み込みに失敗しました: ' + error.message);
    }
}

// PDF処理を確実に行うための分離関数を追加
async function processPdfLocally(pdfArrayBuffer) {
    try {
        console.log('ローカルPDF処理を開始:', pdfArrayBuffer.byteLength, 'バイト');
        statusDiv.textContent = 'PDFをレンダリング中...';
        
        // PDF.jsでドキュメントを読み込み
        console.log('PDF.jsでドキュメントを読み込み開始');
        
        const loadingTask = pdfjsLib.getDocument({ data: pdfArrayBuffer });
        loadingTask.onProgress = (progress) => {
            const percent = Math.round((progress.loaded / progress.total) * 100);
            console.log(`PDF読み込み進捗: ${percent}%`);
            statusDiv.textContent = `PDFを読み込み中... ${percent}%`;
        };
        
        pdfDoc = await loadingTask.promise;
        console.log('PDF読み込み完了。総ページ数:', pdfDoc.numPages);
        
        totalPagesSpan.textContent = pdfDoc.numPages;
        pageNum = 1;
        
        // 既存のナビゲーションボタンのイベントリスナーをセットアップ
        setupNavigationButtons();
        
        // PDFの1ページ目をレンダリング
        console.log('PDFをレンダリング開始: ページ', pageNum);
        await renderPage(pageNum);
        console.log('PDFレンダリング完了: ページ', pageNum);
        
        statusDiv.textContent = 'PDF表示完了';
    } catch (error) {
        console.error('ローカルPDF処理エラー:', error);
        console.error('エラーの詳細:', error.stack);
        statusDiv.textContent = `PDF処理エラー: ${error.message}`;
    }
}

// ページの描画
async function renderPage(num) {
    try {
        console.log('ページレンダリング開始:', num);
        statusDiv.textContent = 'ページを描画中...';

        if (!pdfDoc) {
            console.error('PDFドキュメントが読み込まれていません');
            statusDiv.textContent = 'PDFが読み込まれていません';
            return;
        }

        console.log('ページオブジェクトを取得中...');
        const page = await pdfDoc.getPage(num);
        console.log('ページオブジェクト取得完了');

        // ビューポートの計算
        const containerWidth = canvas.parentElement.clientWidth - 40;
        const containerHeight = canvas.parentElement.clientHeight - 40;
        
        const originalViewport = page.getViewport({ scale: 1.0 });
        const widthScale = containerWidth / originalViewport.width;
        const heightScale = containerHeight / originalViewport.height;
        const scale = Math.min(widthScale, heightScale);
        
        const viewport = page.getViewport({ scale: scale });
        console.log('ビューポート設定:', viewport.width, 'x', viewport.height);

        // キャンバスのサイズを設定
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        
        // キャンバスのスタイルを直接設定
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;

        // ページを描画
        console.log('ページレンダリング開始');
        const renderContext = {
            canvasContext: ctx,
            viewport: viewport
        };
        
        const renderTask = page.render(renderContext);
        await renderTask.promise;
        console.log('ページレンダリング完了');

        currentPageSpan.textContent = num;
        
        // ページナビゲーションボタンの状態を更新
        updateNavigationButtons();

        // ホストの場合、ページ変更を通知
        if (isHost && ws && ws.readyState === WebSocket.OPEN) {
            console.log('ページ変更をWebSocketで通知');
            ws.send(JSON.stringify({
                type: 'page',
                page: num
            }));
        }
        
        statusDiv.textContent = `ページ ${num} を表示中`;
        return true;
    } catch (error) {
        console.error('ページ描画エラー:', error);
        console.error('エラーの詳細:', error.stack);
        statusDiv.textContent = `ページ描画エラー: ${error.message}`;
        return false;
    }
}

// イベントリスナーの設定
fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        loadPDF(e.target.files[0]);
    }
});

prevButton.addEventListener('click', () => {
    if (pageNum <= 1) return;
    pageNum--;
    renderPage(pageNum);
});

nextButton.addEventListener('click', () => {
    if (!pdfDoc || pageNum >= pdfDoc.numPages) return;
    pageNum++;
    renderPage(pageNum);
});

// ウィンドウリサイズ時の処理
let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        if (pdfDoc) {
            renderPage(pageNum);
        }
    }, 200);
});

// スタイルの追加
const style = document.createElement('style');
style.textContent = `
.status {
    margin-top: 10px;
    padding: 8px;
    background-color: #f0f0f0;
    border-radius: 4px;
    text-align: center;
    font-size: 14px;
}

.debugButtons {
    margin-top: 10px;
    text-align: center;
}

.debugButtons button {
    margin: 0 5px;
    padding: 5px 10px;
    background-color: #ddd;
    border: 1px solid #999;
    border-radius: 3px;
    font-size: 12px;
    cursor: pointer;
}
`;
document.head.appendChild(style);

// デバッグボタンの追加
const debugDiv = document.createElement('div');
debugDiv.className = 'debugButtons';

const reconnectButton = document.createElement('button');
reconnectButton.textContent = 'WebSocket再接続';
reconnectButton.onclick = () => {
    if (ws) {
        ws.close();
    }
    setTimeout(() => {
        initWebSocket();
    }, 1000);
};

const statusButton = document.createElement('button');
statusButton.textContent = '接続状態確認';
statusButton.onclick = () => {
    if (ws) {
        console.log('WebSocket状態:', ws.readyState);
        alert(`WebSocket状態: ${ws.readyState === 0 ? '接続中' : 
               ws.readyState === 1 ? '接続済み' : 
               ws.readyState === 2 ? '切断中' : '切断済み'}`);
    } else {
        alert('WebSocket接続がありません');
    }
};

// テスト送信ボタンを追加
const testButton = document.createElement('button');
testButton.textContent = 'テストメッセージ送信';

// WebSocket接続の詳細デバッグ用ボタンを追加
const debugConnectionButton = document.createElement('button');
debugConnectionButton.textContent = '接続の詳細確認';
debugConnectionButton.onclick = () => {
    if (!ws) {
        alert('WebSocket接続がありません');
        return;
    }
    
    const connectionDetails = {
        readyState: ws.readyState,
        readyStateText: ws.readyState === 0 ? '接続中' : 
                        ws.readyState === 1 ? '接続済み' : 
                        ws.readyState === 2 ? '切断中' : '切断済み',
        url: ws.url,
        protocol: ws.protocol || '指定なし',
        extensions: ws.extensions || '拡張なし',
        bufferedAmount: ws.bufferedAmount
    };
    
    console.log('WebSocket接続詳細:', connectionDetails);
    alert(`WebSocket接続の詳細:\n
URL: ${connectionDetails.url}\n
状態: ${connectionDetails.readyStateText} (${connectionDetails.readyState})\n
プロトコル: ${connectionDetails.protocol}\n
拡張: ${connectionDetails.extensions}\n
バッファサイズ: ${connectionDetails.bufferedAmount}バイト`);
};

debugDiv.appendChild(debugConnectionButton);

// pingテストボタンを追加
const pingTestButton = document.createElement('button');
pingTestButton.textContent = 'Pingテスト';
pingTestButton.onclick = () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        alert('WebSocketが接続されていません');
        return;
    }
    
    const pingData = {
        type: 'ping',
        timestamp: Date.now(),
        browser: navigator.userAgent,
        random: Math.random().toString(36).substring(2)
    };
    
    console.log('Pingテストを実行:', pingData);
    sendSecureMessage(pingData);
    statusDiv.textContent = 'Pingテスト送信中...';
};

debugDiv.appendChild(pingTestButton);

// デバッグ情報表示ボタンを追加
const debugInfoButton = document.createElement('button');
debugInfoButton.textContent = 'デバッグ情報';
debugInfoButton.onclick = () => {
    try {
        // サーバーにデバッグ情報をリクエスト
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            console.error('WebSocketが接続されていません');
            alert('WebSocketが接続されていません');
            return;
        }
        
        console.log('サーバーデバッグ情報をリクエスト');
        ws.send(JSON.stringify({
            type: 'debug_request',
            clientInfo: {
                userAgent: navigator.userAgent,
                role: isHost ? 'host' : 'guest',
                url: window.location.href,
                timestamp: Date.now()
            }
        }));
        statusDiv.textContent = 'デバッグ情報をリクエスト中...';
    } catch (error) {
        console.error('デバッグ情報リクエストエラー:', error);
    }
};

// テスト送信のHTMLメッセージボタン追加
const htmlMsgButton = document.createElement('button');
htmlMsgButton.textContent = 'HTMLメッセージ送信';
htmlMsgButton.onclick = () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        alert('WebSocketが接続されていません');
        return;
    }
    
    // HTMLメッセージをテキストとして送信
    const msg = JSON.stringify({
        type: 'test',
        format: 'text',
        message: '文字列としてのテストメッセージ',
        timestamp: Date.now()
    });
    
    console.log('テキストメッセージを送信:', msg);
    ws.send(msg); // テキストとして送信
    statusDiv.textContent = 'HTMLメッセージを送信しました';
};

debugDiv.appendChild(debugInfoButton);
debugDiv.appendChild(htmlMsgButton);

debugDiv.appendChild(reconnectButton);
debugDiv.appendChild(statusButton);
debugDiv.appendChild(testButton);

// PDFレンダリングテストボタン
const testRenderButton = document.createElement('button');
testRenderButton.textContent = 'PDFレンダリングテスト';
testRenderButton.onclick = () => {
    if (!currentPdfData) {
        alert('PDFデータがロードされていません');
        return;
    }
    
    console.log('手動PDFレンダリングテスト開始');
    // スライスでコピーを作成して渡す
    processPdfLocally(currentPdfData.slice(0))
        .then(() => console.log('テストレンダリング完了'))
        .catch(err => console.error('テストレンダリング失敗:', err));
};
debugDiv.appendChild(testRenderButton);

// キャンバスサイズ表示ボタン
const canvasSizeButton = document.createElement('button');
canvasSizeButton.textContent = 'キャンバスサイズ確認';
canvasSizeButton.onclick = () => {
    alert(`キャンバスサイズ: ${canvas.width}x${canvas.height}\nスタイルサイズ: ${canvas.style.width}x${canvas.style.height}\nビューア要素: ${pdfViewer.clientWidth}x${pdfViewer.clientHeight}`);
};
debugDiv.appendChild(canvasSizeButton);

document.querySelector('.controls').appendChild(debugDiv);

// 送信関数を改善
function sendSecureMessage(message) {
    if (!ws) {
        console.error('WebSocketが初期化されていません');
        alert('WebSocketが初期化されていません。再接続してください。');
        return false;
    }
    
    if (ws.readyState !== WebSocket.OPEN) {
        console.error(`WebSocketの状態が不正です: ${ws.readyState}`);
        alert(`WebSocketが接続されていません (状態: ${ws.readyState})`);
        return false;
    }
    
    try {
        // メッセージを文字列化（既に文字列の場合はそのまま）
        const messageStr = typeof message === 'string' ? message : JSON.stringify(message);
        
        // 送信前にコンソールに表示
        console.log(`送信メッセージ (${messageStr.length}バイト):`, messageStr);
        
        // メッセージを送信
        ws.send(messageStr);
        
        // 送信バッファの状態を確認
        console.log(`送信後バッファサイズ: ${ws.bufferedAmount}バイト`);
        
        return true;
    } catch (error) {
        console.error('メッセージ送信エラー:', error);
        alert(`メッセージ送信に失敗しました: ${error.message}`);
        return false;
    }
}

// テスト送信ボタンのイベントハンドラを修正
testButton.onclick = () => {
    const testMsg = {
        type: 'test',
        message: 'これはテストメッセージです',
        timestamp: Date.now()
    };
    
    console.log('テストメッセージ送信開始:', testMsg);
    
    if (sendSecureMessage(testMsg)) {
        statusDiv.textContent = 'テストメッセージを送信しました';
    } else {
        statusDiv.textContent = 'テストメッセージの送信に失敗しました';
    }
};

// 通信ログ表示エリアを追加
const logDiv = document.createElement('div');
logDiv.className = 'logArea';
logDiv.style.cssText = 'max-height: 150px; overflow-y: auto; margin-top: 10px; padding: 5px; background-color: #f8f8f8; border: 1px solid #ddd; font-family: monospace; font-size: 12px;';
logDiv.innerHTML = '<strong>通信ログ:</strong><br>';

// ログ表示関数
function logMessage(direction, message) {
    const now = new Date().toLocaleTimeString();
    const msgText = typeof message === 'string' ? message : JSON.stringify(message);
    const directionClass = direction === 'sent' ? 'sentMsg' : 'receivedMsg';
    
    logDiv.innerHTML += `<div class="${directionClass}">[${now}] ${direction === 'sent' ? '送信' : '受信'}: ${msgText.substring(0, 100)}${msgText.length > 100 ? '...' : ''}</div>`;
    logDiv.scrollTop = logDiv.scrollHeight;
}

// スタイル追加
style.textContent += `
.logArea .sentMsg { color: blue; }
.logArea .receivedMsg { color: green; }
.toggleButton { margin-top: 5px; font-size: 12px; }
`;

// ログ表示/非表示切り替えボタン
const toggleLogButton = document.createElement('button');
toggleLogButton.className = 'toggleButton';
toggleLogButton.textContent = 'ログを表示';
toggleLogButton.onclick = () => {
    if (logDiv.style.display === 'none') {
        logDiv.style.display = 'block';
        toggleLogButton.textContent = 'ログを隠す';
    } else {
        logDiv.style.display = 'none';
        toggleLogButton.textContent = 'ログを表示';
    }
};

// オリジナルのsend関数をオーバーライド
const originalSend = WebSocket.prototype.send;
WebSocket.prototype.send = function(data) {
    try {
        originalSend.call(this, data);
        if (typeof data !== 'string' || data instanceof ArrayBuffer || data instanceof Blob) {
            logMessage('sent', '[バイナリデータ]');
        } else {
            try {
                const jsonData = JSON.parse(data);
                logMessage('sent', jsonData);
            } catch {
                logMessage('sent', data);
            }
        }
    } catch (error) {
        console.error('送信エラーをキャッチ:', error);
        logMessage('sent', `エラー: ${error.message}`);
        throw error; // エラーを再スロー
    }
};

// 元のonmessageハンドラを監視
const origAddEventListener = WebSocket.prototype.addEventListener;
WebSocket.prototype.addEventListener = function(type, listener, options) {
    if (type === 'message') {
        const wrappedListener = function(event) {
            try {
                if (event.data instanceof Blob || event.data instanceof ArrayBuffer) {
                    logMessage('received', '[バイナリデータ]');
                } else {
                    try {
                        const jsonData = JSON.parse(event.data);
                        logMessage('received', jsonData);
                    } catch {
                        logMessage('received', event.data);
                    }
                }
            } catch (error) {
                console.error('受信ログエラー:', error);
            }
            listener(event);
        };
        return origAddEventListener.call(this, type, wrappedListener, options);
    } else {
        return origAddEventListener.call(this, type, listener, options);
    }
};

// ログ領域とボタンを追加
logDiv.style.display = 'none'; // 初期状態では非表示
document.querySelector('.controls').appendChild(toggleLogButton);
document.querySelector('.controls').appendChild(logDiv);

// HTMLの要素を取得
const fullscreenBtn = document.getElementById('fullscreenBtn');
const pdfViewer = document.querySelector('.viewer');

// 全画面モードの状態
let isFullscreen = false;

// 全画面モード用のコントロールエリアを作成
const fullscreenControls = document.createElement('div');
fullscreenControls.className = 'fullscreen-controls';
fullscreenControls.innerHTML = `
    <button id="prevPageFs" disabled>前のページ</button>
    <span id="pageInfoFs">ページ: <span id="currentPageFs">0</span> / <span id="totalPagesFs">0</span></span>
    <button id="nextPageFs" disabled>次のページ</button>
    <button class="exit-fullscreen">全画面終了</button>
`;
document.querySelector('.container').appendChild(fullscreenControls);

// 全画面表示ボタンのイベントリスナー
fullscreenBtn.addEventListener('click', toggleFullscreen);

// 全画面終了ボタンのイベントリスナー
fullscreenControls.querySelector('.exit-fullscreen').addEventListener('click', exitFullscreen);

// 全画面モードでのページネーションボタンのイベントリスナー
const prevPageFs = document.getElementById('prevPageFs');
const nextPageFs = document.getElementById('nextPageFs');
const currentPageFs = document.getElementById('currentPageFs');
const totalPagesFs = document.getElementById('totalPagesFs');

prevPageFs.addEventListener('click', () => {
    if (pageNum <= 1) return;
    pageNum--;
    renderPage(pageNum);
});

nextPageFs.addEventListener('click', () => {
    if (!pdfDoc || pageNum >= pdfDoc.numPages) return;
    pageNum++;
    renderPage(pageNum);
});

// 全画面表示を切り替える関数
function toggleFullscreen() {
    if (!isFullscreen) {
        // 全画面モードに入る
        pdfViewer.classList.add('fullscreen');
        
        // ゲストモードの場合はguestクラスを追加
        if (!isHost) {
            pdfViewer.classList.add('guest');
        }
        
        isFullscreen = true;
        
        // 全画面モード用のページ情報を更新
        updateFullscreenPageInfo();
        
        // ESCキー押下イベントリスナーを追加
        document.addEventListener('keydown', handleEscKey);
    } else {
        exitFullscreen();
    }
}

// 全画面表示を終了する関数
function exitFullscreen() {
    pdfViewer.classList.remove('fullscreen');
    pdfViewer.classList.remove('guest');
    isFullscreen = false;
    document.removeEventListener('keydown', handleEscKey);
}

// ESCキーを押したときの処理
function handleEscKey(event) {
    if (event.key === 'Escape' && isFullscreen) {
        exitFullscreen();
    }
}

// 全画面モード用のページ情報を更新する関数
function updateFullscreenPageInfo() {
    if (!pdfDoc) return;
    
    currentPageFs.textContent = pageNum;
    totalPagesFs.textContent = pdfDoc.numPages;
    
    prevPageFs.disabled = pageNum <= 1;
    nextPageFs.disabled = pageNum >= pdfDoc.numPages;
}

// 既存のrenderPage関数を修正
const originalRenderPage = renderPage;
renderPage = function(num) {
    const result = originalRenderPage(num);
    
    // 全画面モードのページ情報も更新
    if (isFullscreen) {
        updateFullscreenPageInfo();
    }
    
    return result;
};

// ナビゲーションボタンのイベントリスナーを明示的に設定
function setupNavigationButtons() {
    console.log('ナビゲーションボタンの設定を開始');
    
    // 既存のイベントリスナーをクリア（重複防止）
    prevButton.replaceWith(prevButton.cloneNode(true));
    nextButton.replaceWith(nextButton.cloneNode(true));
    
    // 新しい参照を取得
    const newPrevButton = document.getElementById('prevPage');
    const newNextButton = document.getElementById('nextPage');
    
    // 新しいイベントリスナーを設定
    newPrevButton.addEventListener('click', () => {
        console.log('前ページボタンがクリックされました - 現在のページ:', pageNum);
        if (pageNum <= 1) {
            console.log('既に最初のページです');
            return;
        }
        pageNum--;
        console.log('ページを変更します:', pageNum);
        renderPage(pageNum);
    });

    newNextButton.addEventListener('click', () => {
        console.log('次ページボタンがクリックされました - 現在のページ:', pageNum);
        if (!pdfDoc || pageNum >= pdfDoc.numPages) {
            console.log('既に最後のページです');
            return;
        }
        pageNum++;
        console.log('ページを変更します:', pageNum);
        renderPage(pageNum);
    });
    
    // グローバル変数を更新
    prevButton = newPrevButton;
    nextButton = newNextButton;
    
    console.log('ナビゲーションボタンのイベントリスナーを再設定しました');
    
    // ボタンの状態を更新
    updateNavigationButtons();
}

// ボタン状態を更新する関数
function updateNavigationButtons() {
    if (!pdfDoc) {
        prevButton.disabled = true;
        nextButton.disabled = true;
        return;
    }
    
    prevButton.disabled = !isHost || pageNum <= 1;
    nextButton.disabled = !isHost || pageNum >= pdfDoc.numPages;
    
    console.log('ボタン状態を更新:', {
        isHost: isHost,
        pageNum: pageNum,
        totalPages: pdfDoc ? pdfDoc.numPages : 0,
        prevDisabled: prevButton.disabled,
        nextDisabled: nextButton.disabled
    });
}

// 初期化
document.addEventListener('DOMContentLoaded', function() {
    console.log('ページ初期化開始');
    
    // ナビゲーションボタンのデバッグ情報を出力
    console.log('ナビゲーションボタン状態:', {
        prevButton: prevButton ? 'OK' : '未取得',
        prevDisabled: prevButton ? prevButton.disabled : 'N/A',
        nextButton: nextButton ? 'OK' : '未取得',
        nextDisabled: nextButton ? nextButton.disabled : 'N/A'
    });
    
    // イベントリスナーが正しく設定されているか再確認
    prevButton.addEventListener('click', () => {
        console.log('前ページボタンがクリックされました');
        if (pageNum <= 1) return;
        pageNum--;
        renderPage(pageNum);
    });

    nextButton.addEventListener('click', () => {
        console.log('次ページボタンがクリックされました');
        if (!pdfDoc || pageNum >= pdfDoc.numPages) return;
        pageNum++;
        renderPage(pageNum);
    });
    
    // ロール選択要素を非表示にし、URLパラメータでロールを判定
    initializeRole();
    
    // WebSocket接続を初期化
    initWebSocket();
});

// URLハッシュが変更されたときにロールを再初期化
window.addEventListener('hashchange', initializeRole);