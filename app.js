import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, push, onValue, update } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

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
const shoutsRef = ref(db, 'shouts');

let myIdentity = localStorage.getItem('ST_USER') || "User_" + Math.floor(Math.random() * 99);
const identityCard = document.getElementById('identityCard');

document.getElementById('navProfile').onclick = () => identityCard.classList.toggle('hidden');
document.getElementById('saveIdentity').onclick = () => {
    const name = document.getElementById('usernameInput').value.trim();
    if(name) {
        myIdentity = name;
        localStorage.setItem('ST_USER', name);
        identityCard.classList.add('hidden');
    }
};

onValue(shoutsRef, (snapshot) => {
    const data = snapshot.val();
    const posts = data ? Object.keys(data).map(key => ({ ...data[key], fireId: key })) : [];
    const stream = document.getElementById('feedStream');
    stream.innerHTML = "";
    posts.sort((a,b) => b.timestamp - a.timestamp).forEach(p => {
        const postDiv = document.createElement('div');
        postDiv.className = 'post';
        postDiv.innerHTML = `
            <span class="post-user">@${p.user}</span>
            <div class="post-content">${p.content}</div>
            <button class="boost-btn" onclick="window.boost('${p.fireId}', ${p.boosts})">🚀 ${p.boosts}</button>
        `;
        stream.appendChild(postDiv);
    });
});

document.getElementById('postBtn').onclick = () => {
    const input = document.getElementById('postInput');
    if(!input.value.trim()) return;
    push(shoutsRef, {
        user: myIdentity,
        content: input.value,
        type: 'local',
        boosts: 0,
        timestamp: Date.now()
    });
    input.value = "";
};

window.boost = (id, count) => update(ref(db, `shouts/${id}`), { boosts: count + 1 });