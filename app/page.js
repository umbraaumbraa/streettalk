'use client';

import { useEffect, useRef, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import emojiList from 'emoji.json';
import { supabase } from '../lib/supabaseClient';

// localStorage keys
const LS_POSTS = 'streettalk_posts_v4';
const LS_NAME = 'streettalk_username';
const LS_PFP = 'streettalk_profilePic';

// Emoji index helpers (same as before)
const buildEmojiIndex = () => {
  const list = [];
  for (const e of emojiList) {
    const char = e.char || e.emoji || e.native || null;
    const short = e.slug || e.short_name || e.name || null;
    if (!char || !short) continue;
    const code = short.replace(/\s+/g, '_').toLowerCase();
    list.push({ shortcode: code, char, name: e.name || short });
    if (e.short_names && Array.isArray(e.short_names)) {
      for (const s of e.short_names) {
        const sc = s.replace(/\s+/g, '_').toLowerCase();
        list.push({ shortcode: sc, char, name: s });
      }
    }
  }
  const map = new Map();
  for (const item of list) if (!map.has(item.shortcode)) map.set(item.shortcode, item);
  return Array.from(map.values());
};
const EMOJI_INDEX = buildEmojiIndex();

function findEmojiMatches(query, limit = 12) {
  if (!query) return [];
  const q = query.toLowerCase();
  const starts = [];
  const contains = [];
  for (const e of EMOJI_INDEX) {
    if (e.shortcode.startsWith(q)) starts.push(e);
    else if (e.shortcode.includes(q) || (e.name && e.name.toLowerCase().includes(q))) contains.push(e);
  }
  return starts.concat(contains).slice(0, limit);
}

function replaceShortcodesWithEmoji(text) {
  if (!text) return text;
  return text.replace(/:([a-z0-9_+-]+):?/gi, (match, name) => {
    const key = name.toLowerCase();
    const found = EMOJI_INDEX.find((e) => e.shortcode === key);
    return found ? found.char : match;
  });
}

// marked configuration
const renderer = new marked.Renderer();
renderer.link = (href, title, text) => {
  const safe = href || '';
  const titleAttr = title ? ` title="${title}"` : '';
  return `<a href="${safe}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`;
};
marked.setOptions({ renderer, breaks: true, gfm: true });

export default function Page() {
  const [posts, setPosts] = useState([]);
  const [username, setUsername] = useState('');
  const [profilePicDataUrl, setProfilePicDataUrl] = useState('');
  const [newPost, setNewPost] = useState('');
  const [attachment, setAttachment] = useState(null); // { type, dataUrl, file }

  // emoji-autocomplete
  const [emojiQuery, setEmojiQuery] = useState('');
  const [emojiSuggestions, setEmojiSuggestions] = useState([]);
  const [showEmojiDropdown, setShowEmojiDropdown] = useState(false);
  const [dropdownIndex, setDropdownIndex] = useState(0);

  const textRef = useRef(null);
  const composerWrapRef = useRef(null);
  const fileInputRef = useRef(null);
  const attachmentInputRef = useRef(null);

  // load from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_POSTS);
      if (raw) setPosts(JSON.parse(raw));
    } catch {}
    const savedName = localStorage.getItem(LS_NAME);
    const savedPic = localStorage.getItem(LS_PFP);
    if (savedName) setUsername(savedName);
    if (savedPic) setProfilePicDataUrl(savedPic);
  }, []);

  useEffect(() => {
    try { localStorage.setItem(LS_POSTS, JSON.stringify(posts)); } catch {}
  }, [posts]);

  // composer input
  const onComposerInput = (e) => {
    setNewPost(e.target.value);
    updateEmojiQueryFromCaret(e.target);
  };

  const updateEmojiQueryFromCaret = (textarea) => {
    const pos = textarea.selectionStart;
    const before = textarea.value.slice(0, pos);
    const m = before.match(/:([a-z0-9_+-]{1,})$/i);
    if (m) {
      const q = m[1];
      setEmojiQuery(q);
      const list = findEmojiMatches(q, 12);
      setEmojiSuggestions(list);
      setDropdownIndex(0);
      setShowEmojiDropdown(list.length > 0);
    } else {
      setEmojiQuery('');
      setEmojiSuggestions([]);
      setShowEmojiDropdown(false);
    }
  };

  const insertEmojiAtCaret = (emojiChar) => {
    const ta = textRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const before = ta.value.slice(0, start);
    const m = before.match(/:([a-z0-9_+-]{1,})$/i);
    let replaceFrom = start;
    if (m) replaceFrom = start - m[1].length - 1;
    const newVal = ta.value.slice(0, replaceFrom) + emojiChar + ta.value.slice(end);
    setNewPost(newVal);
    const newPos = replaceFrom + emojiChar.length;
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(newPos, newPos);
    });
    setShowEmojiDropdown(false);
    setEmojiQuery('');
    setEmojiSuggestions([]);
  };

  const onComposerKeyDown = (e) => {
    if (showEmojiDropdown) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setDropdownIndex((i) => Math.min(i + 1, emojiSuggestions.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setDropdownIndex((i) => Math.max(i - 1, 0)); return; }
      if (e.key === 'Enter') {
        if (emojiSuggestions.length > 0) { e.preventDefault(); const sel = emojiSuggestions[dropdownIndex]; if (sel) insertEmojiAtCaret(sel.char); }
        return;
      }
      if (e.key === 'Escape') { setShowEmojiDropdown(false); return; }
    }
  };

  // file helpers
  async function fileToResizedDataUrl(file, maxWidth = 512, quality = 0.8) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Failed reading file'));
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const scale = Math.min(1, maxWidth / img.width);
          const w = Math.round(img.width * scale);
          const h = Math.round(img.height * scale);
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = () => reject(new Error('Invalid image'));
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  const handlePickProfile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const resized = await fileToResizedDataUrl(file);
      setProfilePicDataUrl(resized);
      localStorage.setItem(LS_PFP, resized);
      e.target.value = '';
    } catch { alert('Could not load image'); }
  };

  const handleAttachment = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type.startsWith('image/')) {
      const dataUrl = await fileToResizedDataUrl(file);
      setAttachment({ type: 'image', dataUrl, file });
    } else if (file.type.startsWith('video/')) {
      const reader = new FileReader();
      reader.onload = () => setAttachment({ type: 'video', dataUrl: reader.result, file });
      reader.readAsDataURL(file);
    } else { alert('Unsupported file type'); }
    e.target.value = '';
  };

  const triggerAttachmentPicker = () => attachmentInputRef.current?.click();

  const saveUser = () => {
    localStorage.setItem(LS_NAME, username);
    if (profilePicDataUrl) localStorage.setItem(LS_PFP, profilePicDataUrl);
    alert('Saved!');
  };

  const removeProfilePic = () => { setProfilePicDataUrl(''); localStorage.removeItem(LS_PFP); };

  // add post
  const addPost = async () => {
    if (!newPost.trim() && !attachment) return;

    const replaced = replaceShortcodesWithEmoji(newPost.trim());
    const md = marked(replaced);
    const clean = DOMPurify.sanitize(md);

    const post = {
      id: Date.now(),
      username: username || 'Anonymous',
      profilePic: profilePicDataUrl || '',
      rawText: newPost.trim(),
      renderedHtml: clean,
      attachment,
    };

    setPosts((p) => [post, ...p]);
    setNewPost('');
    setAttachment(null);

    // Optional: upload to Supabase
    try {
      await supabase.from('posts').insert([{ 
        username: post.username, 
        content: post.rawText,
        attachment: post.attachment?.type === 'image' || post.attachment?.type === 'video' ? post.attachment.dataUrl : null
      }]);
    } catch (err) { console.warn('Could not post to Supabase', err); }
  };

  const previewHtml = (() => {
    const replaced = replaceShortcodesWithEmoji(newPost || '');
    return DOMPurify.sanitize(marked(replaced));
  })();

  const dropdownStyle = {
    position: 'absolute', zIndex: 30, left: 12, bottom: -6, transform: 'translateY(100%)',
    width: 320, maxHeight: 260, overflow: 'auto',
    background: 'white', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 8,
    boxShadow: '0 6px 18px rgba(15,15,15,0.12)',
  };

  return (
    <main className="min-h-screen bg-gray-50 p-6 font-sans max-w-3xl mx-auto">
      {/* Header */}
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-4xl font-extrabold text-gray-900">StreetTalk</h1>
          <p className="text-sm text-gray-600">Markdown + emoji + attachments.</p>
        </div>
        <div className="text-right">
          <div className="text-sm text-gray-700">Your preview</div>
          <div className="mt-2 flex items-center gap-2">
            {profilePicDataUrl ? (
              <img src={profilePicDataUrl} alt="profile" className="w-12 h-12 rounded-full object-cover border" />
            ) : (
              <div className="w-12 h-12 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 border">?</div>
            )}
            <div className="text-sm text-gray-900">{username || 'Anonymous'}</div>
          </div>
        </div>
      </header>

      {/* User controls */}
      <section className="mb-6 p-4 bg-white rounded-lg shadow-sm">
        <div className="flex gap-4 items-start">
          <div className="flex-shrink-0">
            {profilePicDataUrl ? (
              <img src={profilePicDataUrl} alt="profile" className="w-16 h-16 rounded-full object-cover border" />
            ) : (
              <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center text-gray-400 border">?</div>
            )}
          </div>
          <div className="flex-1">
            <div className="flex gap-2">
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Pick a username"
                className="flex-1 border rounded px-3 py-2 text-black placeholder-gray-400"
              />
              <button onClick={saveUser} className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">Save</button>
            </div>
            <div className="mt-3 flex gap-2 items-center">
              <input ref={fileInputRef} onChange={handlePickProfile} type="file" accept="image/*" className="hidden" />
              <button onClick={() => fileInputRef.current?.click()} className="px-3 py-2 bg-gray-100 border rounded hover:bg-gray-200">Choose picture</button>
              {profilePicDataUrl && <button onClick={removeProfilePic} className="px-3 py-2 bg-red-50 border rounded text-red-600 hover:bg-red-100">Remove</button>}
              <div className="text-xs text-gray-500 ml-auto">Stored only on this browser</div>
            </div>
          </div>
        </div>
      </section>

      {/* Composer */}
      <section className="mb-6 p-4 bg-white rounded-lg shadow-sm relative" ref={composerWrapRef}>
        <textarea
          ref={textRef}
          value={newPost}
          onChange={onComposerInput}
          onKeyDown={onComposerKeyDown}
          placeholder="Write something... :smile for emoji. Markdown supported."
          className="w-full min-h-[120px] border rounded p-3 text-black placeholder-gray-400 resize-vertical"
        />

        {/* Attachments */}
        <div className="mt-2 flex gap-2 items-center">
          <input ref={attachmentInputRef} onChange={handleAttachment} type="file" accept="image/*,video/*" className="hidden" />
          <button onClick={triggerAttachmentPicker} className="px-3 py-2 bg-gray-100 border rounded hover:bg-gray-200">Attach image/video</button>
        </div>

        {attachment && (
          <div className="mt-3 relative">
            {attachment.type === 'image' ? (
              <img src={attachment.dataUrl} className="max-h-64 rounded border" />
            ) : (
              <video src={attachment.dataUrl} controls className="max-h-64 rounded border" />
            )}
            <button onClick={() => setAttachment(null)} className="absolute top-1 right-1 text-red-600 bg-white rounded-full px-2 py-1 text-sm">×</button>
          </div>
        )}

        <div className="mt-3 flex items-start gap-3">
          <button onClick={addPost} className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700">Post</button>
          <div className="flex-1">
            <div className="text-xs text-gray-500 mb-2">Preview:</div>
            <div className="p-3 bg-gray-50 border rounded text-sm" dangerouslySetInnerHTML={{ __html: previewHtml }} />
            {attachment && (
              <div className="mt-2">
                {attachment.type === 'image' ? <img src={attachment.dataUrl} className="max-h-48 rounded border" /> :
                  <video src={attachment.dataUrl} controls className="max-h-48 rounded border" />}
              </div>
            )}
          </div>
        </div>

        {/* Emoji dropdown */}
        {showEmojiDropdown && emojiSuggestions.length > 0 && (
          <div style={dropdownStyle}>
            {emojiSuggestions.map((s, i) => (
              <div key={s.shortcode+i} onMouseDown={(ev)=>{ev.preventDefault(); insertEmojiAtCaret(s.char);}} onMouseEnter={()=>setDropdownIndex(i)}
                style={{padding:'8px 10px', display:'flex', gap:10, alignItems:'center', cursor:'pointer', background: i===dropdownIndex ? 'rgba(0,0,0,0.04)' : 'white'}}>
                <div style={{fontSize:20}}>{s.char}</div>
                <div style={{fontSize:13,color:'#111'}}>
                  <div style={{fontWeight:600}}>{s.shortcode}</div>
                  <div style={{fontSize:12,color:'#555'}}>{s.name}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Feed */}
      <section>
        <h2 className="text-lg font-semibold text-gray-800 mb-3">Recent Posts</h2>
        <div className="flex flex-col gap-4">
          {posts.length===0 && <div className="p-4 bg-white rounded text-gray-600">No posts yet — be the first!</div>}
          {posts.map(p=>(
            <article key={p.id} className="p-4 bg-white rounded shadow-sm">
              <div className="flex gap-3 items-start">
                <div className="flex-shrink-0">
                  {p.profilePic ? (
                    <img src={p.profilePic} alt="pf" className="w-12 h-12 rounded-full object-cover border" />
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center text-gray-400 border">?</div>
                  )}
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium text-gray-900">{p.username}</div>
                      <div className="text-xs text-gray-500">{new Date(p.id).toLocaleString()}</div>
                    </div>
                  </div>
                  <div className="mt-2 text-gray-800 leading-relaxed" dangerouslySetInnerHTML={{__html:p.renderedHtml}} />
                  {p.attachment && (
                    <div className="mt-2">
                      {p.attachment.type==='image' ? <img src={p.attachment.dataUrl} className="max-h-96 rounded border" /> :
                        <video src={p.attachment.dataUrl} controls className="max-h-96 rounded border" />}
                    </div>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
