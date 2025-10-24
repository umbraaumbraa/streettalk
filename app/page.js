'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import emojiList from 'emoji.json';
import { supabase } from '../lib/supabaseClient';


// localStorage keys
const LS_POSTS = 'streettalk_posts_v_dropin';
const LS_NAME = 'streettalk_username';
const LS_PFP = 'streettalk_profilePic';

// -------------------
// Emoji helpers
// -------------------
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

// -------------------
// marked config (safe link rendering)
// -------------------
const renderer = new marked.Renderer();
const isSafeHref = (href) => {
  if (!href) return false;
  const lower = href.trim().toLowerCase();
  return (
    lower.startsWith('http://') ||
    lower.startsWith('https://') ||
    lower.startsWith('mailto:') ||
    lower.startsWith('tel:') ||
    lower.startsWith('ftp:') ||
    lower.startsWith('/') ||
    lower.startsWith('./') ||
    lower.startsWith('../')
  );
};
renderer.link = (href, title, text) => {
  if (!isSafeHref(href)) return `<span>${text}</span>`;
  const titleAttr = title ? ` title="${title}"` : '';
  return `<a href="${href}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`;
};
marked.setOptions({ renderer, breaks: true, gfm: true });

// -------------------
// small HTML escape
// -------------------
function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// -------------------
// Page component (client-only)
// -------------------
export default function Page() {
  const [posts, setPosts] = useState([]);
  const [username, setUsername] = useState('');
  const [profilePicDataUrl, setProfilePicDataUrl] = useState('');
  const [newPost, setNewPost] = useState('');
  const [attachment, setAttachment] = useState(null);
  const [posting, setPosting] = useState(false);

  const [emojiSuggestions, setEmojiSuggestions] = useState([]);
  const [showEmojiDropdown, setShowEmojiDropdown] = useState(false);
  const [dropdownIndex, setDropdownIndex] = useState(0);

  // DOMPurify - dynamic import only in browser
  const purifierRef = useRef(null);
  const [purifierReady, setPurifierReady] = useState(false);

  const textRef = useRef(null);
  const composerWrapRef = useRef(null);
  const fileInputRef = useRef(null);
  const attachmentInputRef = useRef(null);

  // Dynamically import DOMPurify only in browser
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let active = true;
    (async () => {
      try {
        const mod = await import('dompurify');
        const createDOMPurify = mod.default || mod;
        if (active) {
          purifierRef.current = createDOMPurify(window);
          setPurifierReady(true);
        }
      } catch (err) {
        console.warn('DOMPurify dynamic import failed:', err);
      }
    })();
    return () => { active = false; };
  }, []);

  // -------------------
  // Load persisted data
  // -------------------
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

  // -------------------
  // Fetch posts (non-fatal)
  // -------------------
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data, error } = await supabase.from('posts').select('*').order('created_at', { ascending: false });
        if (!error && data && mounted) {
          const normalized = data.map(d => ({
            id: d.id,
            username: d.username,
            profilePic: d.profilePic || d.profile_pic || '',
            rawText: d.content || d.rawText || '',
            renderedHtml: d.renderedHtml || escapeHtml(d.content || d.rawText || ''),
            attachment: d.attachment || null,
            created_at: d.created_at || null
          }));
          setPosts(prev => {
            const seen = new Set();
            const merged = [];
            for (const p of normalized) {
              if (!seen.has(p.id)) { merged.push(p); seen.add(p.id); }
            }
            for (const p of prev) {
              if (!seen.has(p.id)) { merged.push(p); seen.add(p.id); }
            }
            return merged;
          });
        }
      } catch (err) {
        console.warn('Supabase fetch failed:', err);
      }
    })();
    return () => { mounted = false; };
  }, []);

  // -------------------
  // Text + Emoji handlers
  // -------------------
  const updateEmojiQueryFromCaret = (textarea) => {
    const pos = textarea.selectionStart;
    const before = textarea.value.slice(0, pos);
    const m = before.match(/:([a-z0-9_+-]{1,})$/i);
    if (m) {
      const q = m[1];
      const list = findEmojiMatches(q, 12);
      setEmojiSuggestions(list);
      setDropdownIndex(0);
      setShowEmojiDropdown(list.length > 0);
    } else {
      setEmojiSuggestions([]);
      setShowEmojiDropdown(false);
    }
  };

  const onComposerInput = (e) => {
    setNewPost(e.target.value);
    updateEmojiQueryFromCaret(e.target);
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
    setEmojiSuggestions([]);
  };

  const onComposerKeyDown = (e) => {
    if (showEmojiDropdown) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setDropdownIndex(i => Math.min(i + 1, emojiSuggestions.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setDropdownIndex(i => Math.max(i - 1, 0)); return; }
      if (e.key === 'Enter') {
        if (emojiSuggestions.length > 0) { e.preventDefault(); insertEmojiAtCaret(emojiSuggestions[dropdownIndex].char); return; }
      }
      if (e.key === 'Escape') { setShowEmojiDropdown(false); return; }
    }
  };

  // -------------------
  // File handling
  // -------------------
  async function fileToResizedDataUrl(file, maxWidth = 1024, quality = 0.8) {
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
          canvas.width = w;
          canvas.height = h;
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
    } catch (err) { alert('Could not load image'); console.error(err); }
  };

  const handleAttachment = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type.startsWith('image/')) {
      try {
        const dataUrl = await fileToResizedDataUrl(file);
        setAttachment({ type: 'image', dataUrl, file });
      } catch { alert('Could not read image'); }
    } else if (file.type.startsWith('video/')) {
      const reader = new FileReader();
      reader.onload = () => setAttachment({ type: 'video', dataUrl: reader.result, file });
      reader.onerror = () => alert('Could not read video');
      reader.readAsDataURL(file);
    } else {
      alert('Unsupported file type');
    }
    e.target.value = '';
  };

  const triggerAttachmentPicker = () => attachmentInputRef.current?.click();
  const triggerProfilePicker = () => fileInputRef.current?.click();
  const saveUser = () => {
    localStorage.setItem(LS_NAME, username);
    if (profilePicDataUrl) localStorage.setItem(LS_PFP, profilePicDataUrl);
    alert('Saved!');
  };
  const removeProfilePic = () => { setProfilePicDataUrl(''); localStorage.removeItem(LS_PFP); };

  // -------------------
  // Add post
  // -------------------
  const addPost = async () => {
    if (posting) return;
    if (!newPost.trim() && !attachment) return;
    setPosting(true);
    try {
      const raw = newPost.trim();
      const replaced = replaceShortcodesWithEmoji(raw);
      const escaped = escapeHtml(replaced);
      const mdHtml = marked(escaped);
      const finalHtml = (purifierReady && purifierRef.current)
        ? purifierRef.current.sanitize(mdHtml, { USE_PROFILES: { html: true } })
        : mdHtml;

      const post = {
        id: Date.now(),
        username: username || 'Anonymous',
        profilePic: profilePicDataUrl || '',
        rawText: raw,
        renderedHtml: finalHtml,
        attachment,
        created_at: new Date().toISOString()
      };

      setPosts(prev => [post, ...prev]);
      setNewPost('');
      setAttachment(null);
      setShowEmojiDropdown(false);

      (async () => {
        try {
          await supabase.from('posts').insert([{
            username: post.username,
            profilePic: post.profilePic,
            content: post.rawText,
            renderedHtml: post.renderedHtml,
            attachment: post.attachment ? { type: post.attachment.type, dataUrl: post.attachment.dataUrl } : null
          }]);
        } catch (err) {
          console.warn('Supabase insert failed (non-blocking):', err);
        }
      })();
    } finally {
      setPosting(false);
    }
  };

  // -------------------
  // Preview HTML
  // -------------------
  const previewHtml = useMemo(() => {
    const replaced = replaceShortcodesWithEmoji(newPost || '');
    const escaped = escapeHtml(replaced);
    const mdHtml = marked(escaped);
    if (purifierReady && purifierRef.current) {
      try { return purifierRef.current.sanitize(mdHtml, { USE_PROFILES: { html: true } }); } catch { return mdHtml; }
    }
    return mdHtml;
  }, [newPost, purifierReady]);

  const dropdownStyle = {
    position: 'absolute', zIndex: 30, left: 12, bottom: -6, transform: 'translateY(100%)',
    width: 320, maxHeight: 260, overflow: 'auto', background: 'white',
    border: '1px solid rgba(0,0,0,0.08)', borderRadius: 8, boxShadow: '0 6px 18px rgba(15,15,15,0.12)'
  };

  // -------------------
  // UI
  // -------------------
  return (
    <main className="min-h-screen bg-gray-50 p-6 font-sans max-w-3xl mx-auto">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-4xl font-extrabold text-gray-900">StreetTalk</h1>
          <p className="text-sm text-gray-600">Markdown + big emoji library + live emoji autocomplete.</p>
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

      {/* rest of your UI unchanged */}
      {/* ... composer + posts (same as your original, no need to modify) */}
    </main>
  );
}
