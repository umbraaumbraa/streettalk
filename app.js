import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, push, onValue, query, limitToLast, runTransaction } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

const firebaseConfig = {
    apiKey: "AIzaSyCfVuyAmtdcwx-s86wseNG9RQ8VD9KPgXA",
    authDomain: "streettalk-89747.firebaseapp.com",
    databaseURL: "https://streettalk-89747-default-rtdb.firebaseio.com",
    projectId: "streettalk-89747",
    storageBucket: "streettalk-89747.firebasestorage.app",
    messagingSenderId: "759243687775",
    appId: "1:759243687775:web:86e297805174092b785834"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

let user = {
    id: localStorage.getItem('ST_ID') || "U" + Date.now(),
    name: localStorage.getItem('ST_NAME') || "Stranger",
    avatar: localStorage.getItem('ST_AVATAR') || ""
};
if(!localStorage.getItem('ST_ID')) localStorage.setItem('ST_ID', user.id);

let currentSort = 'new';
let globalMediaMap = {};
let lastSnapData = null;

// --- MEDIA VIEWER ---
let vMedia = []; let vIdx = 0;
const renderV = () => {
    const stage = document.getElementById('vStage');
    const item = vMedia[vIdx]; stage.innerHTML = "";
    if (item.type.includes('video')) {
        const v = document.createElement('video'); v.src = item.data; v.controls = true; v.autoplay = true; v.loop = true;
        stage.appendChild(v);
    } else {
        const i = document.createElement('img'); i.src = item.data;
        stage.appendChild(i);
    }
    document.getElementById('vCounter').innerText = `${vIdx+1} / ${vMedia.length}`;
};

const closeV = () => { 
    document.getElementById('mediaModal').classList.add('hidden'); 
    document.getElementById('vStage').innerHTML = ""; 
    document.body.style.overflow = 'auto'; 
};

window.openMedia = (postId, idx) => {
    vMedia = globalMediaMap[postId]; vIdx = idx;
    if(!vMedia) return;
    renderV();
    document.getElementById('mediaModal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
};

// --- KEYBOARD SUPPORT (ESC + Arrows) ---
document.addEventListener('keydown', (e) => {
    const modal = document.getElementById('mediaModal');
    if (modal.classList.contains('hidden')) return;
    
    if (e.key === "Escape") closeV();
    if (e.key === "ArrowRight") { vIdx = (vIdx + 1) % vMedia.length; renderV(); }
    if (e.key === "ArrowLeft") { vIdx = (vIdx - 1 + vMedia.length) % vMedia.length; renderV(); }
});

document.getElementById('viewerBg').onclick = closeV;
document.getElementById('closeViewer').onclick = closeV;
document.getElementById('nextMedia').onclick = (e) => { e.stopPropagation(); vIdx = (vIdx + 1) % vMedia.length; renderV(); };
document.getElementById('prevMedia').onclick = (e) => { e.stopPropagation(); vIdx = (vIdx - 1 + vMedia.length) % vMedia.length; renderV(); };

// --- FEED RENDERER ---
const renderThread = (data, container, path = "shouts") => {
    let keys = Object.keys(data);
    if (path === "shouts") {
        if (currentSort === 'new') keys.sort((a, b) => data[b].timestamp - data[a].timestamp);
        else keys.sort((a, b) => (Object.keys(data[b].votes||{}).length) - (Object.keys(data[a].votes||{}).length));
    }

    keys.forEach(key => {
        const p = data[key];
        const currentPath = `${path}/${key}`;
        if(p.media) globalMediaMap[key] = p.media;

        const voteCount = p.votes ? Object.keys(p.votes).length : 0;
        const hasVoted = p.votes && p.votes[user.id];
        const timeStr = new Date(p.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        const postDiv = document.createElement('div');
        postDiv.className = 'post-wrapper';
        
        let mediaHtml = "";
        if (p.media?.length) {
            mediaHtml = `<div class="media-grid" data-count="${Math.min(p.media.length, 2)}">` + 
                p.media.map((m, i) => `<div class="media-cell" id="c-${key}-${i}">
                    ${m.type.includes('video') ? `<video src="${m.data}" preload="metadata"></video><div class="play-overlay"></div>` : `<img src="${m.data}">`}
                </div>`).join('') + `</div>`;
        }

        postDiv.innerHTML = `
            <div class="post">
                <img src="${p.userAvatar || ''}" class="avatar">
                <div style="flex:1">
                    <div class="post-info"><span style="font-weight:700">${p.user}</span><span class="post-time">${timeStr}</span></div>
                    <div style="color:var(--text); line-height: 1.5; font-size: 0.95rem;">${p.content}</div>
                    ${mediaHtml}
                    <div class="post-actions">
                        <button class="action-btn upvote-btn ${hasVoted ? 'active' : ''}" onclick="window.toggleUpvote('${currentPath}')">▲ ${voteCount}</button>
                        <button class="action-btn" onclick="window.showReplyBox('${key}', '${currentPath}')">💬 Reply</button>
                    </div>
                    <div id="reply-container-${key}" class="hidden"></div>
                </div>
            </div>
            <div id="children-${key}" class="reply-thread"></div>
        `;

        if (p.media) p.media.forEach((m, i) => {
            const cell = postDiv.querySelector(`#c-${key}-${i}`);
            if (cell) cell.onclick = (e) => {
                const video = cell.querySelector('video');
                if (e.target.classList.contains('play-overlay') && video) {
                    e.stopPropagation(); cell.classList.add('playing'); video.controls = true; video.play();
                } else window.openMedia(key, i);
            };
        });

        container.appendChild(postDiv);
        if (p.replies) renderThread(p.replies, postDiv.querySelector(`#children-${key}`), `${currentPath}/replies`);
    });
};

const refreshFeed = () => {
    const stream = document.getElementById('feedStream'); stream.innerHTML = ""; 
    globalMediaMap = {}; if (lastSnapData) renderThread(lastSnapData, stream);
};

onValue(query(ref(db, 'shouts'), limitToLast(50)), (snap) => {
    lastSnapData = snap.val(); refreshFeed();
});

// --- INTERACTIONS ---
window.showReplyBox = (key, path) => {
    const container = document.getElementById(`reply-container-${key}`);
    const isHidden = container.classList.contains('hidden');
    document.querySelectorAll('[id^="reply-container-"]').forEach(el => el.classList.add('hidden')); 
    if(isHidden) {
        container.classList.remove('hidden');
        container.innerHTML = `<div class="reply-composer" style="margin-top:15px;"><textarea id="reply-input-${key}" placeholder="Add to the thread..."></textarea><div style="text-align:right"><button class="post-action-btn" onclick="window.submitReply('${key}', '${path}')" style="padding: 6px 20px; font-size: 0.8rem;">Reply</button></div></div>`;
        container.querySelector('textarea').focus();
    }
};

window.submitReply = (key, path) => {
    const input = document.getElementById(`reply-input-${key}`);
    if (!input.value.trim()) return;
    push(ref(db, `${path}/replies`), { userId: user.id, user: user.name, userAvatar: user.avatar, content: input.value, timestamp: Date.now() });
};

window.toggleUpvote = (path) => {
    runTransaction(ref(db, `${path}/votes`), (v) => { v = v || {}; if (v[user.id]) delete v[user.id]; else v[user.id] = true; return v; });
};

// --- COMPOSER ---
let pending = [];
document.getElementById('mediaBtn').onclick = () => document.getElementById('mediaInput').click();
document.getElementById('mediaInput').onchange = (e) => {
    Array.from(e.target.files).forEach(file => {
        const r = new FileReader();
        r.onload = (ev) => { pending.push({ data: ev.target.result, type: file.type }); renderPre(); };
        r.readAsDataURL(file);
    });
};
const renderPre = () => {
    const g = document.getElementById('mediaGridPre'); g.innerHTML = "";
    if (!pending.length) return g.classList.add('hidden');
    g.classList.remove('hidden');
    pending.forEach((m, i) => {
        const d = document.createElement('div'); d.className = 'pre-item';
        d.innerHTML = `${m.type.includes('video') ? `<video src="${m.data}"></video>` : `<img src="${m.data}">`}<button class="pre-cancel" onclick="window.remPre(${i})">✕</button>`;
        g.appendChild(d);
    });
};
window.remPre = (i) => { pending.splice(i,1); renderPre(); };

document.getElementById('postBtn').onclick = () => {
    const input = document.getElementById('postInput');
    if (!input.value.trim() && !pending.length) return;
    push(ref(db, 'shouts'), { userId: user.id, user: user.name, userAvatar: user.avatar, content: input.value, media: pending, timestamp: Date.now() });
    input.value = ""; pending = []; renderPre();
};

// --- SETTINGS ---
document.getElementById('openSettings').onclick = () => {
    document.getElementById('setName').value = user.name;
    document.getElementById('settingsAvatarPreview').innerHTML = `<img src="${user.avatar || ''}" class="avatar" style="width:100px; height:100px; border:2px solid var(--accent);">`;
    document.getElementById('settingsModal').classList.remove('hidden');
};
document.getElementById('closeSettings').onclick = () => document.getElementById('settingsModal').classList.add('hidden');
document.getElementById('saveSettings').onclick = () => {
    user.name = document.getElementById('setName').value || "Stranger";
    localStorage.setItem('ST_NAME', user.name);
    localStorage.setItem('ST_AVATAR', user.avatar);
    location.reload();
};
document.getElementById('avatarUpload').onchange = (e) => {
    const r = new FileReader();
    r.onload = (ev) => { user.avatar = ev.target.result; document.getElementById('settingsAvatarPreview').innerHTML = `<img src="${user.avatar}" class="avatar" style="width:100px; height:100px; border:2px solid var(--accent);">`; };
    r.readAsDataURL(e.target.files[0]);
};

// --- FILTERS ---
document.getElementById('sortNew').onclick = () => { currentSort = 'new'; document.getElementById('sortNew').classList.add('active'); document.getElementById('sortTop').classList.remove('active'); refreshFeed(); };
document.getElementById('sortTop').onclick = () => { currentSort = 'top'; document.getElementById('sortTop').classList.add('active'); document.getElementById('sortNew').classList.remove('active'); refreshFeed(); };

// --- EMOJI ---
document.getElementById('emojiBtn').onclick = (e) => { e.stopPropagation(); document.getElementById('emojiContainer').classList.toggle('hidden'); };
document.querySelector('emoji-picker').addEventListener('emoji-click', e => { document.getElementById('postInput').value += e.detail.unicode; });

const sync = () => {
    const pic = `<img src="${user.avatar || ''}" class="avatar">`;
    document.getElementById('myProfilePic').innerHTML = pic;
    document.getElementById('inputAvatar').innerHTML = pic;
};
sync();
