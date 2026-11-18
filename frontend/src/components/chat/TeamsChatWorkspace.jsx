import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  MessageSquare,
  Users,
  Search,
  Plus,
  Send,
  Smile,
  Paperclip,
  Pin,
  Trash2,
  Reply,
  Edit2,
  Info,
  CheckCheck,
  X,
  Hash,
  Calendar,
  FileText,
  Download,
  UserPlus,
  UserMinus,
  ArrowLeft,
  Loader2,
  Image as ImageIcon,
  Check,
  Mic,
  Volume2,
  Square,
  Bell,
  BellOff,
  MoreVertical,
  CheckCircle,
  AlertCircle,
} from 'lucide-react';
import { chatService } from '../../services/chatService';
import '../../styles/teamsChat.css';

const QUICK_REPLIES = [
  'Working on it right away! 👍',
  'Please check the latest updates.',
  'Approved, please proceed.',
  'Let us connect in a quick meeting 📞',
  'Thanks for the update! 🎉',
  'Kindly share your attendance update.',
];

const EMOJIS = ['👍', '❤️', '👏', '🎉', '🚀', '😊', '🔥', '✅'];

const formatChatTime = (isoString) => {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '';
    const now = new Date();
    const isToday =
      d.getDate() === now.getDate() &&
      d.getMonth() === now.getMonth() &&
      d.getFullYear() === now.getFullYear();
    if (isToday) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday =
      d.getDate() === yesterday.getDate() &&
      d.getMonth() === yesterday.getMonth() &&
      d.getFullYear() === yesterday.getFullYear();
    if (isYesterday) {
      return 'Yesterday';
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
};

const formatLastSeen = (isoString, isOnline, isTyping) => {
  if (isTyping) return 'typing...';
  if (isOnline) return 'Online';
  if (!isoString) return 'Offline';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return 'Offline';
    const timeStr = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    const now = new Date();
    const isToday =
      d.getDate() === now.getDate() &&
      d.getMonth() === now.getMonth() &&
      d.getFullYear() === now.getFullYear();
    if (isToday) {
      return `last seen today at ${timeStr}`;
    }
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday =
      d.getDate() === yesterday.getDate() &&
      d.getMonth() === yesterday.getMonth() &&
      d.getFullYear() === yesterday.getFullYear();
    if (isYesterday) {
      return `last seen yesterday at ${timeStr}`;
    }
    const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `last seen on ${dateStr}`;
  } catch {
    return 'Offline';
  }
};

const pickLatestTimestamp = (a, b) => {
  const sA = a ? String(a).trim() : '';
  const sB = b ? String(b).trim() : '';
  if (!sA) return sB;
  if (!sB) return sA;
  const tA = new Date(sA).getTime();
  const tB = new Date(sB).getTime();
  if (!Number.isNaN(tA) && !Number.isNaN(tB)) {
    return tA >= tB ? sA : sB;
  }
  return sA >= sB ? sA : sB;
};

const formatFileSize = (bytes) => {
  const num = Number(bytes);
  if (!Number.isFinite(num) || num <= 0) return '';
  if (num < 1024) return `${num} B`;
  if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
  return `${(num / (1024 * 1024)).toFixed(1)} MB`;
};

const getUrlExt = (url) => {
  if (!url) return '';
  try {
    const clean = decodeURIComponent(String(url).split('?')[0].split('#')[0]).toLowerCase();
    const dotIdx = clean.lastIndexOf('.');
    return dotIdx >= 0 ? clean.slice(dotIdx) : '';
  } catch {
    return '';
  }
};

const getAttachmentKind = (att) => {
  if (!att) return 'document';
  const ctype = String(att.content_type || '').toLowerCase();
  const fname = String(att.filename || '').toLowerCase();
  const urlExt = getUrlExt(att.url);
  if (
    att.is_image ||
    ctype.startsWith('image/') ||
    /\.(png|jpe?g|gif|webp|bmp|heic)$/i.test(fname) ||
    /^\.(png|jpe?g|gif|webp|bmp|heic)$/.test(urlExt)
  ) {
    return 'image';
  }
  if (
    att.is_audio ||
    ctype.startsWith('audio/') ||
    fname.includes('voice') ||
    /\.(webm|mp3|wav|ogg|m4a|opus|aac)$/i.test(fname) ||
    /^\.(webm|mp3|wav|ogg|m4a|opus|aac)$/.test(urlExt)
  ) {
    return 'audio';
  }
  return 'document';
};

const findMatchingContact = (contactList, targetId, title) => {
  if (!Array.isArray(contactList) || contactList.length === 0) return null;
  const tId = String(targetId || '').trim().toLowerCase();
  const tName = String(title || '').trim().toLowerCase();
  if (!tId && !tName) return null;
  return (
    contactList.find((ct) => {
      const keys = [ct.id, ct.employee_id, ct.uid, ct.email, ct.name]
        .filter(Boolean)
        .map((k) => String(k).trim().toLowerCase());
      return (tId && keys.includes(tId)) || (tName && keys.includes(tName));
    }) || null
  );
};

const CHAT_BOOTSTRAP_MAX_AGE_MS = 30 * 60 * 1000;
const CHAT_BOOTSTRAP_MAX_CONVS = 10;
const CHAT_BOOTSTRAP_MAX_MSGS_PER_CONV = 40;

const SAMPLE_CHAT_EXCLUDED_NAMES = new Set([
  'admin_approval_391517',
  'dinesh',
  'eight_pwd_291517',
  'emp_20261028180945',
  'employee user',
  'inactive_worker',
  'gopi',
  'late employee test',
  'marco',
  'mounika',
  'marco.mounika',
  'new.employee999',
  'ontime employee test',
  'pallavi',
  'pending_4ba01f',
  'pending_worker',
  'phani',
  'priya',
  'rajesh',
  'rejected_b79005',
  'rejected_worker',
  'rithu',
  'rithuj',
  'rithuk',
  'sameer',
  'sync_approve_6faaal',
  'sync_approve_6faaa1',
  'vinay',
  'yedulla',
  'test_emp_late_checkin_uid_202',
  'tgs1jzpxw7ykthh2zgwpvfac9d62',
  'knamvwbdvvefe6s5qwctlamnegp2',
  'mqafzqg2guf5nmva665fcmc9dqt1',
  'test_user_approved',
]);

const isSampleExcludedChatMember = (item) => {
  if (!item) return false;
  const name = String(item.name || item.title || '').trim().toLowerCase();
  const email = String(item.email || '').trim().toLowerCase();
  const emailPrefix = email.split('@')[0];
  const targetId = String(item.target_id || item.id || item.employee_id || item.uid || '').trim().toLowerCase();
  const convId = String(item.conversation_id || '').trim().toLowerCase();

  if (SAMPLE_CHAT_EXCLUDED_NAMES.has(name)) return true;
  if (SAMPLE_CHAT_EXCLUDED_NAMES.has(emailPrefix)) return true;
  if (SAMPLE_CHAT_EXCLUDED_NAMES.has(targetId)) return true;
  if (SAMPLE_CHAT_EXCLUDED_NAMES.has(convId)) return true;

  if (name.startsWith('test_emp_') || targetId.startsWith('test_emp_') || convId.includes('test_emp_')) return true;
  if (name.includes('tgs1jzpx') || targetId.includes('tgs1jzpx') || convId.includes('tgs1jzpx')) return true;
  if (name.includes('knamvwbd') || targetId.includes('knamvwbd') || convId.includes('knamvwbd')) return true;
  if (name.includes('mqafzqg2') || targetId.includes('mqafzqg2') || convId.includes('mqafzqg2')) return true;
  if (name.includes('admin_approval') || targetId.includes('admin_approval') || convId.includes('admin_approval')) return true;
  if (name.includes('eight_pwd') || targetId.includes('eight_pwd') || convId.includes('eight_pwd')) return true;
  if (name.includes('emp_20261028') || targetId.includes('emp_20261028') || convId.includes('emp_20261028')) return true;

  return false;
};

const getChatBootstrapKey = (userKey) =>
  `arshith_chat_bootstrap_v4_${String(userKey || 'user').trim().toLowerCase()}`;

const readChatBootstrap = (userKey) => {
  const empty = { conversations: [], contacts: [], teams: [], messagesByConv: {}, messageOrder: [] };
  try {
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && (k.startsWith('arshith_chat_bootstrap_v1_') || k.startsWith('arshith_chat_bootstrap_v2_') || k.startsWith('arshith_chat_bootstrap_v3_'))) {
          localStorage.removeItem(k);
        }
      }
    } catch (_) {}

    const raw = localStorage.getItem(getChatBootstrapKey(userKey));
    if (!raw) return empty;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return empty;
    if (parsed.savedAt && Date.now() - parsed.savedAt > CHAT_BOOTSTRAP_MAX_AGE_MS) {
      return empty;
    }
    const rawContacts = Array.isArray(parsed.contacts) ? parsed.contacts : [];
    const rawConvs = Array.isArray(parsed.conversations) ? parsed.conversations : [];
    return {
      conversations: rawConvs.filter((c) => c.type !== 'direct' || !isSampleExcludedChatMember(c)),
      contacts: rawContacts.filter((c) => !isSampleExcludedChatMember(c)),
      teams: Array.isArray(parsed.teams) ? parsed.teams : [],
      messagesByConv:
        parsed.messagesByConv && typeof parsed.messagesByConv === 'object' ? parsed.messagesByConv : {},
      messageOrder: Array.isArray(parsed.messageOrder) ? parsed.messageOrder : [],
    };
  } catch {
    return empty;
  }
};

const writeChatBootstrap = (userKey, patch) => {
  try {
    const key = getChatBootstrapKey(userKey);
    const prev = readChatBootstrap(userKey);
    const nextMessagesByConv = { ...prev.messagesByConv };
    let nextOrder = [...(prev.messageOrder || Object.keys(nextMessagesByConv))];

    if (patch.removeCid) {
      delete nextMessagesByConv[patch.removeCid];
      nextOrder = nextOrder.filter((id) => id !== patch.removeCid);
    }
    if (patch.messagesByConv) {
      Object.entries(patch.messagesByConv).forEach(([cid, msgs]) => {
        if (!cid) return;
        nextOrder = nextOrder.filter((id) => id !== cid);
        if (Array.isArray(msgs) && msgs.length > 0) {
          nextMessagesByConv[cid] = msgs.slice(-CHAT_BOOTSTRAP_MAX_MSGS_PER_CONV);
          nextOrder.push(cid);
        } else {
          delete nextMessagesByConv[cid];
        }
      });
      while (nextOrder.length > CHAT_BOOTSTRAP_MAX_CONVS) {
        const oldest = nextOrder.shift();
        if (oldest) delete nextMessagesByConv[oldest];
      }
    }

    let nextConvs = patch.conversations !== undefined ? patch.conversations : prev.conversations;
    if (patch.removeCid && Array.isArray(nextConvs) && !patch.keepConversation) {
      nextConvs = nextConvs.filter((c) => c.conversation_id !== patch.removeCid);
    }

    const payload = {
      savedAt: Date.now(),
      conversations: nextConvs,
      contacts: patch.contacts !== undefined ? patch.contacts : prev.contacts,
      teams: patch.teams !== undefined ? patch.teams : prev.teams,
      messagesByConv: nextMessagesByConv,
      messageOrder: nextOrder,
    };
    localStorage.setItem(key, JSON.stringify(payload));
  } catch {
    // Ignore storage quota or private mode failures
  }
};

const enrichConversationsWithContacts = (convList, contactsList) => {
  if (!Array.isArray(convList) || !Array.isArray(contactsList) || contactsList.length === 0) {
    return convList;
  }
  return convList.map((c) => {
    if (c.type !== 'direct') return c;
    const matched = findMatchingContact(contactsList, c.target_id, c.title);
    if (!matched) return c;
    return {
      ...c,
      title: matched.name || c.title,
      subtitle: matched.designation
        ? `${matched.designation} • ${matched.department || 'Operations'}`
        : c.subtitle,
      profile_photo: matched.profile_photo || matched.photo_url || c.profile_photo || c.photo_url || null,
      photo_url: matched.photo_url || matched.profile_photo || c.photo_url || c.profile_photo || null,
      uid: matched.uid || c.uid || null,
      is_online: matched.is_online !== undefined ? Boolean(matched.is_online) : Boolean(c.is_online),
      last_seen: pickLatestTimestamp(matched.last_seen, c.last_seen),
      is_typing: Boolean(matched.is_typing),
      typing_conversation_id: matched.typing_conversation_id || '',
      avatar: matched.name ? matched.name.charAt(0).toUpperCase() : c.avatar,
    };
  });
};

const pickInitialConversation = (convList, queryTeam, queryUser) => {
  if (!Array.isArray(convList) || convList.length === 0) return null;
  if (queryTeam) {
    const match = convList.find(
      (c) => c.type === 'team' && (c.target_id === queryTeam || c.title?.toLowerCase() === queryTeam.toLowerCase())
    );
    if (match) return match;
  }
  if (queryUser) {
    const match = convList.find(
      (c) => c.type === 'direct' && String(c.target_id || '').toLowerCase() === queryUser.toLowerCase()
    );
    if (match) return match;
  }
  return convList[0] || null;
};

export default function TeamsChatWorkspace() {
  const [searchParams] = useSearchParams();
  const queryTeam = searchParams.get('team');
  const queryUser = searchParams.get('user');

  // Stored current user profile
  const currentUser = (() => {
    try {
      return JSON.parse(localStorage.getItem('arshith_user')) || {};
    } catch {
      return {};
    }
  })();
  const userRole = localStorage.getItem('arshith_role') || currentUser.role || 'employee';
  const isAdmin = userRole.toLowerCase() === 'admin';
  const myPrimaryId = currentUser.employeeId || currentUser.employee_id || currentUser.id || (isAdmin ? 'ADM-001' : 'employee');

  const bootstrapRef = useRef(null);
  if (bootstrapRef.current === null) {
    bootstrapRef.current = readChatBootstrap(myPrimaryId);
  }
  const initialBootstrap = bootstrapRef.current;

  const myKeys = [
    currentUser.employeeId,
    currentUser.employee_id,
    currentUser.id,
    currentUser.email,
    isAdmin ? 'adm-001' : null,
    isAdmin ? 'admin' : null,
    isAdmin ? 'administrator' : null,
    isAdmin ? 'admin@arshith.com' : null,
    myPrimaryId,
  ].filter(Boolean).map((k) => String(k).trim().toLowerCase());

  const getCanonicalId = (id) => {
    if (!id) return '';
    const clean = String(id).trim();
    const l = clean.toLowerCase();
    if (l === 'adm-001' || l === 'admin' || l === 'administrator' || l === 'admin@arshith.com') {
      return 'ADM-001';
    }
    return clean.toUpperCase();
  };

  // Data states (hydrated immediately from localStorage bootstrap when available)
  const [conversations, setConversations] = useState(() => initialBootstrap.conversations);
  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;

  const [activeConversation, setActiveConversation] = useState(() =>
    pickInitialConversation(initialBootstrap.conversations, queryTeam, queryUser)
  );
  const activeConversationRef = useRef(activeConversation);
  activeConversationRef.current = activeConversation;
  const activeConversationId = activeConversation?.conversation_id || null;
  const currentRequestIdRef = useRef(0);
  const loadGenRef = useRef(0);
  const messagesCacheRef = useRef({ ...(initialBootstrap.messagesByConv || {}) });

  const [messages, setMessages] = useState(() => {
    const initConv = pickInitialConversation(initialBootstrap.conversations, queryTeam, queryUser);
    const cached = initConv?.conversation_id ? initialBootstrap.messagesByConv?.[initConv.conversation_id] : null;
    return Array.isArray(cached) ? cached : [];
  });
  const [contacts, setContacts] = useState(() => initialBootstrap.contacts);
  const contactsRef = useRef(contacts);
  contactsRef.current = contacts;
  const [teams, setTeams] = useState(() => initialBootstrap.teams);
  const [isLoading, setIsLoading] = useState(() => initialBootstrap.conversations.length === 0);
  const [isMessagesLoading, setIsMessagesLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);

  // UI & Filter states
  const [activeTab, setActiveTab] = useState('all'); // 'all', 'direct', 'teams', 'unread'
  const [searchQuery, setSearchQuery] = useState('');
  const [mobileShowChat, setMobileShowChat] = useState(false);
  const [inputMessage, setInputMessage] = useState('');
  const [replyingTo, setReplyingTo] = useState(null);
  const [editingMessage, setEditingMessage] = useState(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [detailsTab, setDetailsTab] = useState('members'); // 'members', 'files', 'pinned'
  const [isHeaderMenuOpen, setIsHeaderMenuOpen] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [isClearingChat, setIsClearingChat] = useState(false);
  const [showDeleteForMeConfirm, setShowDeleteForMeConfirm] = useState(false);
  const [isDeletingForMe, setIsDeletingForMe] = useState(false);
  const [showDeleteGroupConfirm, setShowDeleteGroupConfirm] = useState(false);
  const [isDeletingGroup, setIsDeletingGroup] = useState(false);
  const [isNewChatOpen, setIsNewChatOpen] = useState(false);
  const [typingUsers, setTypingUsers] = useState({});
  const [toastNotification, setToastNotification] = useState(null);
  const toastTimerRef = useRef(null);

  const isMuted = Boolean(activeConversation?.is_muted);
  const isPinned = Boolean(activeConversation?.is_pinned);

  // Attachments & Lightbox
  const [attachedFile, setAttachedFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [lightboxImage, setLightboxImage] = useState(null);

  // Group creation modal state
  const [modalTab, setModalTab] = useState('direct'); // 'direct' or 'group'
  const [newChatSearch, setNewChatSearch] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupDescription, setNewGroupDescription] = useState('');
  const [selectedGroupMembers, setSelectedGroupMembers] = useState([]);
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [groupMemberSearch, setGroupMemberSearch] = useState('');

  // Add member dropdown state
  const [showAddMemberSelect, setShowAddMemberSelect] = useState(false);
  const [selectedAddMemberId, setSelectedAddMemberId] = useState('');

  // Voice message recording states
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [isSendingVoice, setIsSendingVoice] = useState(false);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recordingTimerRef = useRef(null);
  const recordingStartTimeRef = useRef(0);

  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const imageInputRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const headerMenuRef = useRef(null);
  const pendingPrefOverridesRef = useRef({});

  const sortConversationsList = useCallback((list) => {
    return [...list].sort((a, b) => {
      const pinDiff = Number(Boolean(b?.is_pinned)) - Number(Boolean(a?.is_pinned));
      if (pinDiff !== 0) return pinDiff;
      const tA = a?.last_message_at ? new Date(a.last_message_at).getTime() || 0 : 0;
      const tB = b?.last_message_at ? new Date(b.last_message_at).getTime() || 0 : 0;
      return tB - tA;
    });
  }, []);

  const applyPendingPrefOverride = useCallback((conv) => {
    if (!conv?.conversation_id) return conv;
    const entry = pendingPrefOverridesRef.current[conv.conversation_id];
    if (!entry) return conv;
    if (entry.expiresAt <= Date.now()) {
      delete pendingPrefOverridesRef.current[conv.conversation_id];
      return conv;
    }
    return { ...conv, ...entry.fields };
  }, []);

  // Scroll to bottom of message list
  const scrollToBottom = (smooth = true) => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' });
    }
  };

  // Component-level helper for matching contacts by id/employee_id/uid/email/name
  const matchContact = (targetId, title) => findMatchingContact(contacts, targetId, title);

  // Load conversations immediately while enriching contacts & teams progressively in background
  const loadInitialData = useCallback(async (silent = false) => {
    const loadGen = ++loadGenRef.current;
    try {
      if (!silent && conversationsRef.current.length === 0) {
        setIsLoading(true);
      }

      const convsPromise = chatService.getConversations();
      const contactsPromise = chatService.getContacts();
      const teamsPromise = chatService.getTeams();

      const settledTeams = teamsPromise
        .then((teamsData) => {
          if (loadGen !== loadGenRef.current || !Array.isArray(teamsData)) return;
          setTeams(teamsData);
          writeChatBootstrap(myPrimaryId, { teams: teamsData });
        })
        .catch((err) => console.error('Failed to load teams:', err));

      const settledContacts = contactsPromise
        .then((contactsData) => {
          if (loadGen !== loadGenRef.current || !Array.isArray(contactsData)) return null;
          const cleanContacts = contactsData.filter((c) => !isSampleExcludedChatMember(c));
          contactsRef.current = cleanContacts;
          setContacts(cleanContacts);
          writeChatBootstrap(myPrimaryId, { contacts: cleanContacts });
          setConversations((prev) => {
            const enriched = sortConversationsList(
              enrichConversationsWithContacts(prev, cleanContacts).map(applyPendingPrefOverride)
            );
            writeChatBootstrap(myPrimaryId, { conversations: enriched });
            return enriched;
          });
          setActiveConversation((prev) => {
            if (!prev || prev.type !== 'direct') return prev;
            return enrichConversationsWithContacts([prev], cleanContacts)[0];
          });
          return cleanContacts;
        })
        .catch((err) => {
          console.error('Failed to load contacts:', err);
          return null;
        });

      const convsData = await convsPromise;
      if (loadGen !== loadGenRef.current) return;

      const rawConvList = Array.isArray(convsData)
        ? convsData.filter((c) => c.type !== 'direct' || !isSampleExcludedChatMember(c))
        : [];
      const convList = enrichConversationsWithContacts(rawConvList, contactsRef.current);
      const sortedConvs = sortConversationsList(convList.map(applyPendingPrefOverride));

      if (convsData !== null) {
        setConversations(sortedConvs);
        writeChatBootstrap(myPrimaryId, { conversations: sortedConvs });
      }

      // Determine initial active conversation or preserve currently selected
      let selected = null;
      const currentActive = activeConversationRef.current;
      const currentActiveId = currentActive?.conversation_id;
      if (currentActiveId) {
        const foundInFresh = sortedConvs.find((c) => c.conversation_id === currentActiveId);
        if (foundInFresh) {
          selected = foundInFresh;
        } else if (currentActive.type === 'direct') {
          selected = currentActive;
          setConversations((prev) =>
            prev.some((c) => c.conversation_id === currentActiveId) ? prev : [currentActive, ...prev]
          );
        }
      }

      if (!selected) {
        selected = pickInitialConversation(sortedConvs, queryTeam, queryUser);
      }

      if (!selected && queryUser) {
        const awaitedContacts = await settledContacts;
        if (loadGen !== loadGenRef.current) return;
        const foundContact = findMatchingContact(awaitedContacts || contactsRef.current, queryUser, queryUser);
        if (foundContact) {
          const targetRef = foundContact.uid || foundContact.employee_id || foundContact.id;
          let persistedCid = null;
          try {
            const ensured = await chatService.ensureDirectConversation(targetRef);
            persistedCid = ensured?.conversation_id || null;
          } catch {
            // Fall back cleanly if offline/unauthenticated
          }
          const myCanonical = getCanonicalId(myPrimaryId);
          const targetCanonical = getCanonicalId(foundContact.employee_id || foundContact.id);
          const pair = [myCanonical, targetCanonical].sort();
          selected = {
            conversation_id: persistedCid || `dm_${pair[0]}_${pair[1]}`,
            type: 'direct',
            target_id: foundContact.employee_id || foundContact.id,
            title: foundContact.name,
            subtitle: `${foundContact.designation || 'Staff'} • ${foundContact.department || 'Operations'}`,
            avatar: foundContact.name ? foundContact.name.charAt(0).toUpperCase() : (foundContact.avatar || 'U'),
            profile_photo: foundContact.profile_photo || foundContact.photo_url || null,
            photo_url: foundContact.photo_url || foundContact.profile_photo || null,
            uid: foundContact.uid || null,
            is_online: foundContact.is_online,
            last_seen: foundContact.last_seen || '',
            last_message: '',
            unread_count: 0,
          };
          setConversations((prev) =>
            prev.some((c) => c.conversation_id === selected.conversation_id) ? prev : [selected, ...prev]
          );
        }
      }

      // Default to first conversation
      if (!selected && sortedConvs.length > 0) {
        selected = sortedConvs[0];
      }

      if (selected) {
        setActiveConversation(enrichConversationsWithContacts([selected], contactsRef.current)[0]);
      } else if (convsData !== null && currentActiveId && currentActive?.type === 'team') {
        setActiveConversation(null);
      }

      setIsLoading(false);
      await Promise.allSettled([settledContacts, settledTeams]);
    } catch (err) {
      console.error('Failed to load chat data:', err);
    } finally {
      if (loadGen === loadGenRef.current) {
        setIsLoading(false);
      }
    }
  }, [queryTeam, queryUser, myPrimaryId, sortConversationsList, applyPendingPrefOverride]);

  // Load messages for currently active conversation
  const loadMessages = useCallback(async (conv, reqId, { silent = false } = {}) => {
    if (!conv) {
      setMessages([]);
      setIsMessagesLoading(false);
      return;
    }
    try {
      if (!silent) {
        setIsMessagesLoading(true);
      }
      const msgs = await chatService.getMessages(conv.type, conv.target_id, 60, conv.conversation_id);
      if (reqId !== currentRequestIdRef.current || activeConversationRef.current?.conversation_id !== conv.conversation_id) {
        return;
      }
      const nextMsgs = Array.isArray(msgs) ? msgs : [];
      messagesCacheRef.current[conv.conversation_id] = nextMsgs;
      writeChatBootstrap(myPrimaryId, { messagesByConv: { [conv.conversation_id]: nextMsgs } });
      setMessages(nextMsgs);
      // Mark unread as read
      chatService.markRead(conv.type, conv.target_id, conv.conversation_id).catch(() => {});
      // Clear unread badge locally
      setConversations((prev) =>
        prev.map((c) => (c.conversation_id === conv.conversation_id ? { ...c, unread_count: 0 } : c))
      );
    } catch (err) {
      console.error('Failed to load messages:', err);
      if (reqId === currentRequestIdRef.current && !silent) {
        setMessages([]);
      }
    } finally {
      if (reqId === currentRequestIdRef.current) {
        setIsMessagesLoading(false);
        if (!silent) {
          setTimeout(() => scrollToBottom(false), 80);
        }
      }
    }
  }, [myPrimaryId]);

  // Initial load
  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  // Close header three-dots menu when switching conversations or clicking outside
  useEffect(() => {
    setIsHeaderMenuOpen(false);
    setShowClearConfirm(false);
    setShowDeleteForMeConfirm(false);
  }, [activeConversationId]);

  useEffect(() => {
    if (!isHeaderMenuOpen) return undefined;
    const handleOutsideClick = (event) => {
      if (headerMenuRef.current && !headerMenuRef.current.contains(event.target)) {
        setIsHeaderMenuOpen(false);
      }
    };
    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setIsHeaderMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isHeaderMenuOpen]);

  // Only reload messages when the selected conversation_id actually changes (not on presence/profile updates)
  useEffect(() => {
    const conv = activeConversationRef.current;
    if (activeConversationId && conv) {
      if (conv.type !== 'team') {
        setIsDetailsOpen(false);
      }
      setEditingMessage(null);
      setReplyingTo(null);
      setAttachedFile(null);
      currentRequestIdRef.current += 1;
      const reqId = currentRequestIdRef.current;
      const cached = messagesCacheRef.current[activeConversationId];
      if (Array.isArray(cached) && cached.length > 0) {
        setMessages(cached);
        setIsMessagesLoading(false);
        setTimeout(() => scrollToBottom(false), 30);
        loadMessages(conv, reqId, { silent: true });
      } else {
        setMessages([]);
        loadMessages(conv, reqId, { silent: false });
      }
    } else {
      setMessages([]);
      setIsMessagesLoading(false);
      setIsDetailsOpen(false);
    }
  }, [activeConversationId, loadMessages]);

  // WebSocket real-time subscription & Polling fallback
  useEffect(() => {
    const handleWsEvent = (event) => {
      if (event.type === 'new_message' && event.message) {
        const msg = event.message;
        const currentConv = activeConversationRef.current;

        const normMsgCid = String(msg.conversation_id || '').toLowerCase().replace(/^team_/, '');
        const msgTeamId = String(msg.team_id || msg.target_id || '').toLowerCase().replace(/^team_/, '');
        const msgSender = String(msg.sender_id || '').toLowerCase();
        const msgReceiver = String(msg.receiver_id || '').toLowerCase();

        // Check if message belongs to currently open conversation
        if (currentConv) {
          const normCurCid = String(currentConv.conversation_id || '').toLowerCase().replace(/^team_/, '');
          const normCurTarget = String(currentConv.target_id || '').toLowerCase().replace(/^team_/, '');

          const isDirectMatch =
            (currentConv.type === 'direct' || msg.chat_type === 'direct') &&
            (normMsgCid === normCurCid ||
              (myKeys.includes(msgSender) && (normCurTarget === msgReceiver || (currentConv.title && currentConv.title.toLowerCase() === String(msg.receiver_name || '').toLowerCase()))) ||
              (myKeys.includes(msgReceiver) && (normCurTarget === msgSender || (currentConv.title && currentConv.title.toLowerCase() === String(msg.sender_name || '').toLowerCase()))));

          const isTeamMatch =
            (currentConv.type === 'team' || msg.chat_type === 'team') &&
            (normMsgCid === normCurCid ||
              normMsgCid === normCurTarget ||
              msgTeamId === normCurTarget ||
              (currentConv.title && msg.team_name && currentConv.title.toLowerCase() === msg.team_name.toLowerCase()));

          const isCurrentConv = normMsgCid === normCurCid || isTeamMatch || isDirectMatch;

          if (isCurrentConv) {
            setMessages((prev) => {
              if (prev.some((m) => m.id === msg.id)) return prev;
              const next = [...prev, msg];
              messagesCacheRef.current[currentConv.conversation_id] = next;
              writeChatBootstrap(myPrimaryId, { messagesByConv: { [currentConv.conversation_id]: next } });
              return next;
            });
            setTimeout(() => scrollToBottom(true), 50);
          }
        }

        // Update conversation preview snippet and unread badges
        let matchedAnyConversation = false;
        setConversations((prev) =>
          sortConversationsList(
            prev.map((c) => {
              const normCCid = String(c.conversation_id || '').toLowerCase().replace(/^team_/, '');
              const normCTarget = String(c.target_id || '').toLowerCase().replace(/^team_/, '');

              const isDirectMatch =
                (c.type === 'direct' || msg.chat_type === 'direct') &&
                (normMsgCid === normCCid ||
                  (myKeys.includes(msgSender) && (normCTarget === msgReceiver || (c.title && c.title.toLowerCase() === String(msg.receiver_name || '').toLowerCase()))) ||
                  (myKeys.includes(msgReceiver) && (normCTarget === msgSender || (c.title && c.title.toLowerCase() === String(msg.sender_name || '').toLowerCase()))));

              const isTeamMatch =
                (c.type === 'team' || msg.chat_type === 'team') &&
                (normMsgCid === normCCid ||
                  normMsgCid === normCTarget ||
                  msgTeamId === normCTarget ||
                  (c.title && msg.team_name && c.title.toLowerCase() === msg.team_name.toLowerCase()));

              const matches = normMsgCid === normCCid || isTeamMatch || isDirectMatch;
              if (matches) {
                matchedAnyConversation = true;
                const cur = activeConversationRef.current;
                const isActive = cur && (
                  String(cur.conversation_id || '').toLowerCase().replace(/^team_/, '') === normCCid ||
                  String(cur.target_id || '').toLowerCase().replace(/^team_/, '') === normCTarget
                );
                return {
                  ...c,
                  last_message: msg.content || (msg.attachments?.length ? 'Shared an attachment' : ''),
                  last_message_sender: msg.sender_name,
                  last_message_at: msg.created_at,
                  unread_count: isActive ? 0 : (c.unread_count || 0) + 1,
                };
              }
              return c;
            })
          )
        );
        if (!matchedAnyConversation) {
          loadInitialData(true);
        }
      } else if (event.type === 'message_edited') {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === event.message_id
              ? { ...m, content: event.content, is_edited: true, updated_at: event.updated_at }
              : m
          )
        );
      } else if (event.type === 'reaction_updated') {
        setMessages((prev) =>
          prev.map((m) => (m.id === event.message_id ? { ...m, reactions: event.reactions } : m))
        );
      } else if (event.type === 'pin_updated') {
        setMessages((prev) =>
          prev.map((m) => (m.id === event.message_id ? { ...m, is_pinned: event.is_pinned } : m))
        );
      } else if (event.type === 'message_deleted') {
        setMessages((prev) => prev.filter((m) => m.id !== event.message_id));
      } else if (event.type === 'new_team' && event.team) {
        loadInitialData(true);
      } else if (event.type === 'team_updated') {
        loadInitialData(true);
      } else if (event.type === 'team_deleted') {
        const delTid = String(event.team_id || '');
        const delCid = String(event.conversation_id || '');
        if (delCid) {
          delete messagesCacheRef.current[delCid];
          writeChatBootstrap(myPrimaryId, { removeCid: delCid });
        }
        setTeams((prev) =>
          prev.filter((t) => String(t.id) !== delTid && String(t.conversation_id || '') !== delCid)
        );
        setConversations((prev) =>
          prev.filter((c) => c.conversation_id !== delCid && String(c.target_id) !== delTid)
        );
        if (
          activeConversationRef.current &&
          (activeConversationRef.current.conversation_id === delCid ||
            String(activeConversationRef.current.target_id) === delTid)
        ) {
          setMessages([]);
          setActiveConversation(null);
          setIsDetailsOpen(false);
          setShowClearConfirm(false);
          setShowDeleteGroupConfirm(false);
          setMobileShowChat(false);
        }
      } else if (event.type === 'user_profile_updated') {
        const { user_id, employee_id, photo_url, profile_photo, name } = event;
        const photo = profile_photo || photo_url;
        const matchesUser = (item) => {
          if (!item) return false;
          const target = String(item.target_id || '').trim().toLowerCase();
          const title = String(item.title || '').trim().toLowerCase();
          const uId = String(user_id || '').trim().toLowerCase();
          const eId = String(employee_id || '').trim().toLowerCase();
          const n = String(name || '').trim().toLowerCase();
          return (
            (uId && (target === uId || title === uId)) ||
            (eId && (target === eId || title === eId)) ||
            (n && (target === n || title === n))
          );
        };

        setConversations((prev) =>
          prev.map((c) => {
            if (c.type === 'direct' && matchesUser(c)) {
              return {
                ...c,
                title: name || c.title,
                profile_photo: photo !== undefined ? photo : c.profile_photo,
                photo_url: photo !== undefined ? photo : c.photo_url,
                avatar: name ? name.charAt(0).toUpperCase() : c.avatar,
              };
            }
            return c;
          })
        );

        setActiveConversation((prev) => {
          if (prev && prev.type === 'direct' && matchesUser(prev)) {
            return {
              ...prev,
              title: name || prev.title,
              profile_photo: photo !== undefined ? photo : prev.profile_photo,
              photo_url: photo !== undefined ? photo : prev.photo_url,
              avatar: name ? name.charAt(0).toUpperCase() : prev.avatar,
            };
          }
          return prev;
        });

        setContacts((prev) =>
          prev.map((ct) => {
            const ctId = String(ct.id || '').trim().toLowerCase();
            const ctEmpId = String(ct.employee_id || '').trim().toLowerCase();
            const uId = String(user_id || '').trim().toLowerCase();
            const eId = String(employee_id || '').trim().toLowerCase();
            if ((uId && ctId === uId) || (eId && ctEmpId === eId)) {
              return {
                ...ct,
                name: name || ct.name,
                profile_photo: photo !== undefined ? photo : ct.profile_photo,
                photo_url: photo !== undefined ? photo : ct.photo_url,
                avatar: name ? name.charAt(0).toUpperCase() : ct.avatar,
              };
            }
            return ct;
          })
        );
      } else if (event.type === 'typing') {
        const currentConv = activeConversationRef.current;
        if (currentConv && event.target_id === currentConv.target_id.toLowerCase()) {
          setTypingUsers((prev) => ({
            ...prev,
            [event.sender_name]: event.is_typing,
          }));
          if (event.is_typing) {
            setTimeout(() => {
              setTypingUsers((prev) => {
                const next = { ...prev };
                delete next[event.sender_name];
                return next;
              });
            }, 3000);
          }
        }
      } else if (event.type === 'presence') {
        const evOnline =
          event.is_online !== undefined
            ? Boolean(event.is_online)
            : String(event.status || '').toLowerCase() === 'online';
        const evLastSeen = evOnline ? undefined : (event.last_seen || new Date().toISOString());
        const evKeys = [event.user_id, event.employee_id, event.uid, event.email, event.target_id]
          .filter(Boolean)
          .map((k) => String(k).trim().toLowerCase());

        const matchesPresence = (item) => {
          if (!item || evKeys.length === 0) return false;
          const itemKeys = [item.id, item.employee_id, item.uid, item.email, item.target_id]
            .filter(Boolean)
            .map((k) => String(k).trim().toLowerCase());
          return itemKeys.some((k) => evKeys.includes(k));
        };

        setContacts((prev) =>
          prev.map((ct) =>
            matchesPresence(ct)
              ? {
                  ...ct,
                  is_online: evOnline,
                  last_seen: evLastSeen !== undefined ? pickLatestTimestamp(evLastSeen, ct.last_seen) : (ct.last_seen || ''),
                }
              : ct
          )
        );
        setConversations((prev) =>
          prev.map((c) =>
            c.type === 'direct' && matchesPresence(c)
              ? {
                  ...c,
                  is_online: evOnline,
                  last_seen: evLastSeen !== undefined ? pickLatestTimestamp(evLastSeen, c.last_seen) : (c.last_seen || ''),
                }
              : c
          )
        );
        setActiveConversation((prev) =>
          prev && prev.type === 'direct' && matchesPresence(prev)
            ? {
                ...prev,
                is_online: evOnline,
                last_seen: evLastSeen !== undefined ? pickLatestTimestamp(evLastSeen, prev.last_seen) : (prev.last_seen || ''),
              }
            : prev
        );
      }
    };

    const cleanupWs = chatService.connectWebSocket(handleWsEvent);

    // Light polling interval (every 4 seconds) to ensure synchronization with mobile APK & Firestore
    let pollTick = 0;
    const pollInterval = setInterval(() => {
      pollTick += 1;
      const currentConv = activeConversationRef.current;
      if (currentConv) {
        chatService
          .getMessages(currentConv.type, currentConv.target_id, 60, currentConv.conversation_id)
          .then((fresh) => {
            if (activeConversationRef.current?.conversation_id !== currentConv.conversation_id) {
              return;
            }
            if (Array.isArray(fresh)) {
              messagesCacheRef.current[currentConv.conversation_id] = fresh;
              writeChatBootstrap(myPrimaryId, { messagesByConv: { [currentConv.conversation_id]: fresh } });
              setMessages((prev) => {
                if (
                  fresh.length !== prev.length ||
                  fresh[fresh.length - 1]?.id !== prev[prev.length - 1]?.id ||
                  fresh.some((m, idx) => m.content !== prev[idx]?.content)
                ) {
                  return fresh;
                }
                return prev;
              });
            }
          })
          .catch(() => {});
      }

      // Every 8 seconds (every 2 ticks), refresh conversations, teams, and live mobile/web presence
      if (pollTick % 2 === 0) {
        chatService.getConversations().then((freshConvs) => {
          if (Array.isArray(freshConvs) && freshConvs.length > 0) {
            setConversations((prev) => {
              const cur = activeConversationRef.current;
              const curId = cur?.conversation_id;
              const merged = freshConvs.map((fc) => {
                const existing = prev.find((p) => p.conversation_id === fc.conversation_id);
                return applyPendingPrefOverride({
                  ...(existing || {}),
                  ...fc,
                  last_seen: pickLatestTimestamp(fc.last_seen, existing?.last_seen),
                  unread_count: curId === fc.conversation_id ? 0 : (fc.unread_count || 0),
                });
              });
              if (cur && cur.type === 'direct' && !merged.some((m) => m.conversation_id === curId)) {
                merged.unshift(cur);
              }
              return sortConversationsList(merged);
            });
            const cur = activeConversationRef.current;
            if (cur) {
              const rawMatchedConv = freshConvs.find((fc) => fc.conversation_id === cur.conversation_id);
              const matchedConv = rawMatchedConv ? applyPendingPrefOverride(rawMatchedConv) : null;
              if (matchedConv) {
                setActiveConversation((prev) => {
                  if (!prev || prev.conversation_id !== matchedConv.conversation_id) return prev;
                  const nextPinned = Boolean(matchedConv.is_pinned);
                  const nextMuted = Boolean(matchedConv.is_muted);
                  if (matchedConv.type !== 'direct') {
                    if (Boolean(prev.is_pinned) === nextPinned && Boolean(prev.is_muted) === nextMuted) {
                      return prev;
                    }
                    return { ...prev, is_pinned: nextPinned, is_muted: nextMuted };
                  }
                  const nextOnline = matchedConv.is_online;
                  const nextLastSeen = pickLatestTimestamp(matchedConv.last_seen, prev.last_seen);
                  const nextTyping = Boolean(matchedConv.is_typing);
                  const nextTypingCid = matchedConv.typing_conversation_id || '';
                  if (
                    prev.is_online === nextOnline &&
                    (prev.last_seen || '') === nextLastSeen &&
                    Boolean(prev.is_typing) === nextTyping &&
                    (prev.typing_conversation_id || '') === nextTypingCid &&
                    Boolean(prev.is_pinned) === nextPinned &&
                    Boolean(prev.is_muted) === nextMuted
                  ) {
                    return prev;
                  }
                  return {
                    ...prev,
                    is_online: nextOnline,
                    last_seen: nextLastSeen,
                    is_typing: nextTyping,
                    typing_conversation_id: nextTypingCid,
                    is_pinned: nextPinned,
                    is_muted: nextMuted,
                  };
                });
              }
            }
          }
        }).catch(() => {});

        chatService.getTeams().then((freshTeams) => {
          if (Array.isArray(freshTeams)) {
            setTeams(freshTeams);
          }
        }).catch(() => {});

        chatService.getPresence().then((presenceRes) => {
          const pMap = presenceRes?.presence || presenceRes || {};
          if (!pMap || typeof pMap !== 'object') return;
          const resolveFromMap = (item) => {
            const keys = [item?.uid, item?.employee_id, item?.id, item?.email, item?.target_id]
              .filter(Boolean)
              .map((k) => String(k).trim().toLowerCase());
            for (const k of keys) {
              if (pMap[k]) return pMap[k];
            }
            return null;
          };
          setContacts((prev) =>
            prev.map((ct) => {
              const p = resolveFromMap(ct);
              return p
                ? {
                    ...ct,
                    is_online: Boolean(p.is_online ?? p.online),
                    last_seen: pickLatestTimestamp(p.last_seen, ct.last_seen),
                    is_typing: Boolean(p.is_typing ?? p.typing),
                    typing_conversation_id: p.typing_conversation_id || '',
                  }
                : ct;
            })
          );
          setConversations((prev) =>
            prev.map((c) => {
              if (c.type !== 'direct') return c;
              const p = resolveFromMap(c);
              if (!p) return c;
              const nextOnline = Boolean(p.is_online ?? p.online);
              const nextLastSeen = pickLatestTimestamp(p.last_seen, c.last_seen);
              const nextTyping = Boolean(p.is_typing ?? p.typing);
              const nextTypingCid = p.typing_conversation_id || '';
              if (
                c.is_online === nextOnline &&
                (c.last_seen || '') === nextLastSeen &&
                Boolean(c.is_typing) === nextTyping &&
                (c.typing_conversation_id || '') === nextTypingCid
              ) {
                return c;
              }
              return {
                ...c,
                is_online: nextOnline,
                last_seen: nextLastSeen,
                is_typing: nextTyping,
                typing_conversation_id: nextTypingCid,
              };
            })
          );
          setActiveConversation((prev) => {
            if (!prev || prev.type !== 'direct') return prev;
            const p = resolveFromMap(prev);
            if (!p) return prev;
            const nextOnline = Boolean(p.is_online ?? p.online);
            const nextLastSeen = pickLatestTimestamp(p.last_seen, prev.last_seen);
            const nextTyping = Boolean(p.is_typing ?? p.typing);
            const nextTypingCid = p.typing_conversation_id || '';
            if (
              prev.is_online === nextOnline &&
              (prev.last_seen || '') === nextLastSeen &&
              Boolean(prev.is_typing) === nextTyping &&
              (prev.typing_conversation_id || '') === nextTypingCid
            ) {
              return prev;
            }
            return {
              ...prev,
              is_online: nextOnline,
              last_seen: nextLastSeen,
              is_typing: nextTyping,
              typing_conversation_id: nextTypingCid,
            };
          });
        }).catch(() => {});
      }
    }, 4000);

    return () => {
      cleanupWs();
      clearInterval(pollInterval);
    };
  }, [loadInitialData]);

  // Re-sync chat data when tab or window gains focus to reflect updated profiles & live presence
  useEffect(() => {
    const handleFocusOrVisible = () => {
      if (document.visibilityState === 'hidden') return;
      chatService.connectWebSocket();
      loadInitialData(true);
    };
    window.addEventListener('focus', handleFocusOrVisible);
    document.addEventListener('visibilitychange', handleFocusOrVisible);
    return () => {
      window.removeEventListener('focus', handleFocusOrVisible);
      document.removeEventListener('visibilitychange', handleFocusOrVisible);
    };
  }, [loadInitialData]);

  // Handle typing notification
  const handleInputChange = (e) => {
    setInputMessage(e.target.value);
    if (activeConversation) {
      chatService.sendTyping(activeConversation.type, activeConversation.target_id, true);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        chatService.sendTyping(activeConversation.type, activeConversation.target_id, false);
      }, 1500);
    }
  };

  // Shared upload helper (used by file input, photo input, and clipboard paste)
  const uploadAndAttachFile = async (file) => {
    if (!file) return;

    if (file.size > 15 * 1024 * 1024) {
      alert('File exceeds the maximum limit of 15MB.');
      return;
    }

    try {
      setIsUploading(true);
      const res = await chatService.uploadAttachment(file);
      setAttachedFile(res);
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to upload attachment.');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (imageInputRef.current) imageInputRef.current.value = '';
    }
  };

  // File upload selection
  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await uploadAndAttachFile(file);
  };

  // Clipboard image paste inside composer
  const handleComposerPaste = async (e) => {
    const items = e.clipboardData?.items;
    if (!items || items.length === 0) return;
    for (let i = 0; i < items.length; i += 1) {
      if (items[i].type && items[i].type.startsWith('image/')) {
        const blob = items[i].getAsFile();
        if (blob) {
          e.preventDefault();
          const ext = (items[i].type.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '');
          const pastedFile = new File([blob], `Pasted_Image_${Date.now()}.${ext}`, {
            type: items[i].type,
          });
          await uploadAndAttachFile(pastedFile);
          return;
        }
      }
    }
  };

  // Start editing a message
  const handleStartEdit = (msg) => {
    setEditingMessage(msg);
    setInputMessage(msg.content);
    setReplyingTo(null);
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  };

  // Cancel edit mode
  const handleCancelEdit = () => {
    setEditingMessage(null);
    setInputMessage('');
  };

  // Start voice recording from microphone
  const startRecording = async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert('Voice recording is not supported in this browser.');
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];

      let preferredMime = '';
      if (typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function') {
        const candidates = [
          'audio/mp4',
          'audio/webm;codecs=opus',
          'audio/webm',
          'audio/ogg;codecs=opus',
        ];
        preferredMime = candidates.find((m) => MediaRecorder.isTypeSupported(m)) || '';
      }

      const mediaRecorder = preferredMime
        ? new MediaRecorder(stream, { mimeType: preferredMime })
        : new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recordingStartTimeRef.current = Date.now();
      mediaRecorder.start(200);
      setIsRecording(true);
      setRecordingDuration(0);

      recordingTimerRef.current = setInterval(() => {
        setRecordingDuration((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      console.error('Error starting audio recording:', err);
      alert('Microphone permission is required to record voice messages. Please grant microphone access.');
    }
  };

  // Cancel and discard voice recording
  const cancelRecording = () => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (mediaRecorderRef.current) {
      try {
        mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
      } catch {}
      mediaRecorderRef.current = null;
    }
    audioChunksRef.current = [];
    recordingStartTimeRef.current = 0;
    setIsRecording(false);
    setRecordingDuration(0);
  };

  // Stop recording and send voice message
  const stopAndSendVoiceMessage = async () => {
    if (!mediaRecorderRef.current || !activeConversation) return;

    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }

    const elapsedMs = recordingStartTimeRef.current
      ? Math.max(700, Date.now() - recordingStartTimeRef.current)
      : Math.max(700, recordingDuration * 1000);
    const durationSec = Math.max(1, Math.round(elapsedMs / 1000));
    const min = Math.floor(durationSec / 60);
    const sec = durationSec % 60;
    const timeStr = `${min}:${sec < 10 ? '0' : ''}${sec}`;

    setIsSendingVoice(true);

    const recorder = mediaRecorderRef.current;
    const recordedMime = recorder.mimeType || 'audio/webm';
    const isMp4 = recordedMime.includes('mp4') || recordedMime.includes('m4a');
    const isOgg = recordedMime.includes('ogg');
    const fileExt = isMp4 ? 'm4a' : isOgg ? 'ogg' : 'webm';
    const uploadMime = isMp4 ? 'audio/mp4' : isOgg ? 'audio/ogg' : 'audio/webm';

    recorder.onstop = async () => {
      try {
        recorder.stream.getTracks().forEach((track) => track.stop());
        const audioBlob = new Blob(audioChunksRef.current, { type: uploadMime });

        if (audioBlob.size === 0) {
          setIsRecording(false);
          setIsSendingVoice(false);
          return;
        }

        let voiceAttachment = null;
        try {
          const file = new File([audioBlob], `Voice_Message_${Date.now()}.${fileExt}`, { type: uploadMime });
          const uploaded = await chatService.uploadAttachment(file);
          voiceAttachment = {
            ...uploaded,
            is_audio: true,
            duration_ms: elapsedMs,
            filename: `Voice Message (${timeStr})`,
          };
        } catch (uploadErr) {
          console.warn('Attachment upload failed, encoding as DataURL:', uploadErr);
          const dataUrl = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(audioBlob);
          });
          voiceAttachment = {
            url: dataUrl,
            filename: `Voice Message (${timeStr})`,
            file_size: audioBlob.size,
            duration_ms: elapsedMs,
            is_image: false,
            is_audio: true,
            content_type: uploadMime,
          };
        }

        const created = await chatService.sendMessage({
          chatType: activeConversation.type,
          targetId: activeConversation.target_id,
          conversationId: activeConversation.conversation_id,
          content: `🎤 Voice message (${timeStr})`,
          attachments: [voiceAttachment],
        });

        if (activeConversationRef.current?.conversation_id === activeConversation.conversation_id) {
          setMessages((prev) => {
            if (prev.some((m) => m.id === created.id)) return prev;
            return [...prev, created];
          });
          setTimeout(() => scrollToBottom(true), 80);
        }
      } catch (sendErr) {
        console.error('Failed to send voice message:', sendErr);
        alert('Failed to send voice message. Please try again.');
      } finally {
        setIsRecording(false);
        setRecordingDuration(0);
        recordingStartTimeRef.current = 0;
        setIsSendingVoice(false);
        mediaRecorderRef.current = null;
        audioChunksRef.current = [];
      }
    };

    recorder.stop();
  };

  // Send message or Save Edit
  const handleSendMessage = async (e) => {
    if (e) e.preventDefault();
    const cleanContent = inputMessage.trim();
    if ((!cleanContent && !attachedFile) || !activeConversation || isSending) return;

    // Handle Edit Mode
    if (editingMessage) {
      try {
        setIsSending(true);
        await chatService.editMessage(editingMessage.id, cleanContent);
        setMessages((prev) =>
          prev.map((m) => (m.id === editingMessage.id ? { ...m, content: cleanContent, is_edited: true } : m))
        );
        setEditingMessage(null);
        setInputMessage('');
      } catch (err) {
        alert(err.response?.data?.detail || 'Failed to edit message.');
      } finally {
        setIsSending(false);
      }
      return;
    }

    // Normal Send Mode
    try {
      setIsSending(true);
      setInputMessage('');
      const replyData = replyingTo
        ? {
            id: replyingTo.id,
            sender_name: replyingTo.sender_name,
            content_snippet: replyingTo.content.substring(0, 80),
          }
        : null;

      setReplyingTo(null);
      const toSendAttachment = attachedFile ? [attachedFile] : [];
      setAttachedFile(null);

      const created = await chatService.sendMessage({
        chatType: activeConversation.type,
        targetId: activeConversation.target_id,
        conversationId: activeConversation.conversation_id,
        content: cleanContent || (toSendAttachment.length ? `Shared: ${toSendAttachment[0].filename}` : ''),
        attachments: toSendAttachment,
        replyTo: replyData,
      });

      if (activeConversationRef.current?.conversation_id === activeConversation.conversation_id) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === created.id)) return prev;
          return [...prev, created];
        });
        setTimeout(() => scrollToBottom(true), 50);
      }

      // Refresh conversations list snippet
      setConversations((prev) =>
        prev.map((c) =>
          c.conversation_id === activeConversation.conversation_id
            ? {
                ...c,
                last_message: cleanContent || (toSendAttachment.length ? toSendAttachment[0].filename : ''),
                last_message_at: new Date().toISOString(),
              }
            : c
        )
      );
    } catch (err) {
      console.error('Failed to send message:', err);
      alert(err.response?.data?.detail || 'Failed to send message. Please try again.');
    } finally {
      setIsSending(false);
      if (textareaRef.current) {
        textareaRef.current.focus();
      }
    }
  };

  // Keyboard shortcut: Enter to send, Shift+Enter for newline, Esc to cancel edit
  const handleKeyDown = (e) => {
    if (e.key === 'Escape' && editingMessage) {
      handleCancelEdit();
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Quick reaction toggle
  const handleToggleReaction = async (messageId, emoji) => {
    try {
      const res = await chatService.toggleReaction(messageId, emoji);
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, reactions: res.reactions } : m))
      );
    } catch (err) {
      console.error('Failed to toggle reaction:', err);
    }
  };

  // Toggle pin
  const handleTogglePin = async (messageId) => {
    try {
      const res = await chatService.togglePin(messageId);
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, is_pinned: res.is_pinned } : m))
      );
    } catch (err) {
      console.error('Failed to pin message:', err);
    }
  };

  // Delete message
  const handleDeleteMessage = async (messageId) => {
    if (window.confirm('Delete this message for everyone?')) {
      try {
        await chatService.deleteMessage(messageId);
        setMessages((prev) => prev.filter((m) => m.id !== messageId));
      } catch (err) {
        console.error('Failed to delete message:', err);
      }
    }
  };

  // Start new conversation from modal (Contact)
  const handleStartChatWithContact = async (contact) => {
    const targetCanonical = getCanonicalId(contact.employee_id || contact.id);
    const photo = contact.profile_photo || contact.photo_url || null;
    const existing = conversations.find(
      (c) =>
        c.type === 'direct' &&
        (c.target_id.toLowerCase() === String(contact.id).toLowerCase() ||
          (contact.employee_id && c.target_id.toLowerCase() === String(contact.employee_id).toLowerCase()) ||
          getCanonicalId(c.target_id) === targetCanonical)
    );
    const targetRef = contact.uid || contact.employee_id || contact.id;
    let persistedCid = null;
    try {
      const ensured = await chatService.ensureDirectConversation(targetRef);
      persistedCid = ensured?.conversation_id || null;
    } catch {
      // Keep UI responsive even if backend is temporarily unreachable
    }
    if (existing) {
      const updatedExisting = {
        ...existing,
        conversation_id: persistedCid || existing.conversation_id,
        title: contact.name || existing.title,
        profile_photo: photo || existing.profile_photo,
        photo_url: photo || existing.photo_url,
        uid: contact.uid || existing.uid || null,
        is_online: contact.is_online !== undefined ? contact.is_online : existing.is_online,
        last_seen: contact.last_seen || existing.last_seen || '',
        avatar: contact.name ? contact.name.charAt(0).toUpperCase() : existing.avatar,
      };
      setConversations((prev) =>
        prev.map((c) => (c.conversation_id === existing.conversation_id ? updatedExisting : c))
      );
      setActiveConversation(updatedExisting);
      setMobileShowChat(true);
    } else {
      const myCanonical = getCanonicalId(myPrimaryId);
      const pair = [myCanonical, targetCanonical].sort();
      const newConv = {
        conversation_id: persistedCid || `dm_${pair[0]}_${pair[1]}`,
        type: 'direct',
        target_id: contact.employee_id || contact.id,
        title: contact.name,
        subtitle: `${contact.designation || 'Staff'} • ${contact.department || 'Operations'}`,
        avatar: contact.name ? contact.name.charAt(0).toUpperCase() : (contact.avatar || 'U'),
        profile_photo: photo,
        photo_url: photo,
        uid: contact.uid || null,
        is_online: contact.is_online,
        last_seen: contact.last_seen || '',
        last_message: '',
        unread_count: 0,
      };
      setConversations((prev) =>
        prev.some((c) => c.conversation_id === newConv.conversation_id)
          ? prev
          : [newConv, ...prev]
      );
      setActiveConversation(newConv);
      setMobileShowChat(true);
    }
    setIsNewChatOpen(false);
  };

  // Select team channel
  const handleSelectTeamChannel = (team) => {
    const teamCid = team.conversation_id || `team_${team.id}`;
    const existing = conversations.find(
      (c) =>
        c.type === 'team' &&
        (String(c.target_id) === String(team.id) || c.conversation_id === teamCid)
    );
    if (existing) {
      setActiveConversation(existing);
    } else {
      const newConv = {
        conversation_id: teamCid,
        type: 'team',
        target_id: String(team.id),
        title: team.name,
        subtitle: `${team.department || 'Company'} • ${team.member_count || 0} members`,
        avatar: '#',
        last_message: '',
        unread_count: 0,
      };
      setConversations((prev) => [newConv, ...prev]);
      setActiveConversation(newConv);
      setMobileShowChat(true);
    }
    setIsNewChatOpen(false);
  };

  // Create team group channel
  const handleCreateGroup = async (e) => {
    e.preventDefault();
    if (!newGroupName.trim()) {
      alert('Please enter a team group name.');
      return;
    }

    try {
      setIsCreatingGroup(true);
      const created = await chatService.createGroup({
        name: newGroupName.trim(),
        description: newGroupDescription.trim(),
        memberIds: selectedGroupMembers,
      });

      const newConv = {
        conversation_id: created.conversation_id || `team_${created.id}`,
        type: 'team',
        target_id: String(created.id),
        title: created.name,
        subtitle: `Custom Group • ${created.member_count || created.members?.length || 1} members`,
        avatar: '#',
        last_message: `Group '${created.name}' created`,
        last_message_at: created.created_at,
        unread_count: 0,
      };
      messagesCacheRef.current[newConv.conversation_id] = [];
      setMessages([]);
      setTeams((prev) => [created, ...prev.filter((t) => String(t.id) !== String(created.id))]);
      setConversations((prev) => [newConv, ...prev.filter((c) => c.conversation_id !== newConv.conversation_id)]);
      setActiveTab('all');
      setActiveConversation(newConv);
      setMobileShowChat(true);

      setIsNewChatOpen(false);
      setNewChatSearch('');
      setNewGroupName('');
      setNewGroupDescription('');
      setSelectedGroupMembers([]);
      setGroupMemberSearch('');
      loadInitialData(true);
    } catch (err) {
      alert(err.response?.data?.detail || err.message || 'Failed to create group.');
    } finally {
      setIsCreatingGroup(false);
    }
  };

  // Toggle group member selection for new group
  const handleToggleMemberSelection = (id) => {
    setSelectedGroupMembers((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
    );
  };

  // Edit group name
  const handleEditGroupName = async () => {
    if (!activeConversation || activeConversation.type !== 'team') return;
    const nextName = window.prompt('Enter new group name:', activeConversation.title || '');
    if (!nextName || !nextName.trim() || nextName.trim() === activeConversation.title) return;
    const cleanName = nextName.trim();
    try {
      await chatService.updateGroup(activeConversation.target_id || activeConversation.conversation_id, { name: cleanName });
      setTeams((prev) =>
        prev.map((t) =>
          String(t.id) === String(activeConversation.target_id) || t.conversation_id === activeConversation.conversation_id
            ? { ...t, name: cleanName, teamName: cleanName }
            : t
        )
      );
      setConversations((prev) =>
        prev.map((c) =>
          c.conversation_id === activeConversation.conversation_id ? { ...c, title: cleanName } : c
        )
      );
      setActiveConversation((prev) =>
        prev && prev.conversation_id === activeConversation.conversation_id ? { ...prev, title: cleanName } : prev
      );
      loadMessages(activeConversation);
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to rename group.');
    }
  };

  // Edit group description
  const handleEditGroupDescription = async () => {
    if (!activeConversation || activeConversation.type !== 'team') return;
    const currentTeam = teams.find(
      (t) => String(t.id) === String(activeConversation.target_id) || t.conversation_id === activeConversation.conversation_id
    );
    const nextDesc = window.prompt('Enter group description:', currentTeam?.description || '');
    if (nextDesc === null) return;
    const cleanDesc = nextDesc.trim();
    try {
      await chatService.updateGroup(activeConversation.target_id || activeConversation.conversation_id, { description: cleanDesc });
      setTeams((prev) =>
        prev.map((t) =>
          String(t.id) === String(activeConversation.target_id) || t.conversation_id === activeConversation.conversation_id
            ? { ...t, description: cleanDesc }
            : t
        )
      );
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to update group description.');
    }
  };

  // Add member to current group
  const handleAddMemberToCurrentGroup = async () => {
    if (!selectedAddMemberId || !activeConversation || activeConversation.type !== 'team') return;
    try {
      const res = await chatService.addGroupMember(
        activeConversation.target_id || activeConversation.conversation_id,
        selectedAddMemberId
      );
      setTeams((prev) =>
        prev.map((t) =>
          String(t.id) === String(activeConversation.target_id) || t.conversation_id === activeConversation.conversation_id
            ? { ...t, members: res.members, member_ids: res.member_ids || t.member_ids, member_count: res.members.length }
            : t
        )
      );
      setSelectedAddMemberId('');
      setShowAddMemberSelect(false);
      loadMessages(activeConversation);
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to add member.');
    }
  };

  // Remove member or leave group
  const handleRemoveMemberFromGroup = async (userId) => {
    if (!activeConversation || activeConversation.type !== 'team') return;
    const isSelf = userId.toLowerCase() === myPrimaryId.toLowerCase();
    const promptMsg = isSelf
      ? 'Are you sure you want to leave this group channel?'
      : `Remove employee ${userId} from this group?`;

    if (!window.confirm(promptMsg)) return;

    try {
      const res = await chatService.removeGroupMember(
        activeConversation.target_id || activeConversation.conversation_id,
        userId
      );
      if (isSelf) {
        setConversations((prev) => prev.filter((c) => c.conversation_id !== activeConversation.conversation_id));
        setActiveConversation(null);
      } else {
        setTeams((prev) =>
          prev.map((t) =>
            String(t.id) === String(activeConversation.target_id) || t.conversation_id === activeConversation.conversation_id
              ? { ...t, members: res.members, member_ids: res.member_ids || t.member_ids, member_count: res.members.length }
              : t
          )
        );
        loadMessages(activeConversation);
      }
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to remove member.');
    }
  };

  // Pin / Mute conversation preference handler (header menu + drawer button)
  const handleUpdateConversationPref = async (conv, { pinned, muted } = {}) => {
    if (!conv?.conversation_id) return;
    const cid = conv.conversation_id;
    const patchFields = {};
    if (pinned !== undefined) patchFields.is_pinned = Boolean(pinned);
    if (muted !== undefined) patchFields.is_muted = Boolean(muted);

    const prevOverride = pendingPrefOverridesRef.current[cid]?.fields || {};
    pendingPrefOverridesRef.current[cid] = {
      fields: { ...prevOverride, ...patchFields },
      expiresAt: Date.now() + 6000,
    };

    setConversations((prev) =>
      sortConversationsList(
        prev.map((c) => (c.conversation_id === cid ? { ...c, ...patchFields } : c))
      )
    );
    setActiveConversation((prev) =>
      prev && prev.conversation_id === cid ? { ...prev, ...patchFields } : prev
    );

    try {
      const res = await chatService.updateConversationSettings({
        conversationId: cid,
        chatType: conv.type,
        targetId: conv.target_id,
        pinned,
        muted,
      });
      const confirmed = {
        ...(pinned !== undefined ? { is_pinned: Boolean(res?.is_pinned ?? pinned) } : {}),
        ...(muted !== undefined ? { is_muted: Boolean(res?.is_muted ?? muted) } : {}),
      };
      setConversations((prev) =>
        sortConversationsList(
          prev.map((c) => (c.conversation_id === cid ? { ...c, ...confirmed } : c))
        )
      );
      setActiveConversation((prev) =>
        prev && prev.conversation_id === cid ? { ...prev, ...confirmed } : prev
      );
    } catch (err) {
      delete pendingPrefOverridesRef.current[cid];
      alert(err.response?.data?.detail || 'Failed to update chat settings.');
      loadInitialData(true);
    }
  };

  const handleOpenDetailsDrawer = () => {
    setIsHeaderMenuOpen(false);
    setIsDetailsOpen(true);
    if (activeConversation?.type === 'team') {
      setDetailsTab('members');
    } else if (detailsTab === 'members') {
      setDetailsTab('files');
    }
  };

  const handleConfirmClearChat = async () => {
    const conv = activeConversationRef.current;
    if (!conv?.conversation_id || isClearingChat) return;
    const cid = conv.conversation_id;
    const emptyPreview = conv.type === 'team' ? 'No messages yet' : 'Start a conversation';

    setIsClearingChat(true);
    try {
      const res = await chatService.clearConversation({
        conversationId: cid,
        chatType: conv.type,
        targetId: conv.target_id,
      });
      const clearedFields = {
        last_message: emptyPreview,
        last_message_sender: '',
        unread_count: 0,
        ...(res?.cleared_at ? { cleared_at: res.cleared_at } : {}),
      };
      pendingPrefOverridesRef.current[cid] = {
        fields: {
          ...(pendingPrefOverridesRef.current[cid]?.fields || {}),
          ...clearedFields,
        },
        expiresAt: Date.now() + 6000,
      };
      messagesCacheRef.current[cid] = [];
      writeChatBootstrap(myPrimaryId, { removeCid: cid, keepConversation: true });
      setMessages([]);
      setReplyingTo(null);
      setEditingMessage(null);
      setConversations((prev) =>
        prev.map((c) => (c.conversation_id === cid ? { ...c, ...clearedFields } : c))
      );
      setActiveConversation((prev) =>
        prev && prev.conversation_id === cid ? { ...prev, ...clearedFields } : prev
      );
      setShowClearConfirm(false);
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to clear chat history.');
    } finally {
      setIsClearingChat(false);
    }
  };

  const showToast = useCallback((message, type = 'success') => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastNotification({ message, type });
    toastTimerRef.current = setTimeout(() => {
      setToastNotification(null);
    }, 3500);
  }, []);

  // WhatsApp-style "Delete for Me": deletes conversation from user's inbox only
  const handleConfirmDeleteForMe = async () => {
    if (!activeConversation || isDeletingForMe) return;
    const targetConv = activeConversation;
    const targetCid = targetConv.conversation_id;
    setIsDeletingForMe(true);

    try {
      await chatService.deleteConversationForMe({
        conversationId: targetCid,
        chatType: targetConv.type,
        targetId: targetConv.target_id,
      });

      // Remove from left conversation list immediately (no refresh required)
      setConversations((prev) => {
        const nextList = prev.filter((c) => c.conversation_id !== targetCid);
        writeChatBootstrap(myPrimaryId, { conversations: nextList });
        return nextList;
      });

      if (targetCid) {
        delete messagesCacheRef.current[targetCid];
      }

      setShowDeleteForMeConfirm(false);
      setActiveConversation(null);
      setMessages([]);
      setMobileShowChat(false);
      showToast(`Deleted "${targetConv.title}" from your inbox.`, 'success');
    } catch (err) {
      console.error('Failed to delete conversation for me:', err);
      showToast(err.response?.data?.detail || 'Failed to delete conversation from your inbox.', 'error');
    } finally {
      setIsDeletingForMe(false);
    }
  };

  // Permanently delete group across website & mobile app
  const handleConfirmDeleteGroup = async () => {
    if (!activeConversation || activeConversation.type !== 'team' || isDeletingGroup) return;
    const targetGroupId =
      currentTeamObj?.id || activeConversation.target_id || activeConversation.conversation_id;
    const delCid = activeConversation.conversation_id;
    setIsDeletingGroup(true);
    try {
      await chatService.deleteGroup(targetGroupId);
      if (delCid) {
        delete messagesCacheRef.current[delCid];
        writeChatBootstrap(myPrimaryId, { removeCid: delCid });
      }
      setTeams((prev) =>
        prev.filter(
          (t) =>
            String(t.id) !== String(targetGroupId) &&
            String(t.conversation_id || '') !== String(delCid || '')
        )
      );
      setConversations((prev) =>
        prev.filter(
          (c) =>
            c.conversation_id !== delCid && String(c.target_id) !== String(targetGroupId)
        )
      );
      setMessages([]);
      setActiveConversation(null);
      setIsDetailsOpen(false);
      setShowDeleteGroupConfirm(false);
      setMobileShowChat(false);
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to delete group.');
    } finally {
      setIsDeletingGroup(false);
    }
  };

  // Filter conversations
  const filteredConversations = conversations.filter((c) => {
    if (isSampleExcludedChatMember(c)) {
      return false;
    }
    const matchesTab =
      activeTab === 'all' ||
      (activeTab === 'direct' && c.type === 'direct') ||
      (activeTab === 'teams' && c.type === 'team') ||
      (activeTab === 'unread' && (c.unread_count || 0) > 0);
    const matchesQuery =
      !searchQuery ||
      c.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.last_message && c.last_message.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesTab && matchesQuery;
  });

  const pinnedMessage = messages.find((m) => m.is_pinned);
  const typingNames = Object.keys(typingUsers).filter((name) => typingUsers[name]);

  // Active channel team object if active is a team
  const currentTeamObj =
    activeConversation?.type === 'team'
      ? teams.find(
          (t) =>
            String(t.id) === String(activeConversation.target_id) ||
            (t.conversation_id && t.conversation_id === activeConversation.conversation_id) ||
            `team_${t.id}` === activeConversation.conversation_id
        )
      : null;

  const isGeneralTeamChannel =
    activeConversation?.type === 'team' &&
    (/general/i.test(activeConversation?.title || '') ||
      /all company/i.test(activeConversation?.title || ''));

  const canDeleteActiveGroup =
    activeConversation?.type === 'team' &&
    !isGeneralTeamChannel &&
    (Boolean(activeConversation?.can_delete) ||
      Boolean(currentTeamObj?.can_delete) ||
      isAdmin ||
      myKeys.includes(String(currentTeamObj?.created_by || activeConversation?.created_by || '').trim().toLowerCase()) ||
      myKeys.includes(String(currentTeamObj?.created_by_uid || activeConversation?.created_by_uid || '').trim().toLowerCase()));

  // List of shared attachments in the active conversation
  const sharedAttachments = messages
    .flatMap((m) => m.attachments || [])
    .filter(Boolean);

  return (
    <div className={`teams-chat-container animate-fade-in ${mobileShowChat && activeConversation ? 'mobile-chat-open' : ''}`}>
      {/* Hidden File & Image Inputs for Attachments */}
      <input
        type="file"
        ref={fileInputRef}
        style={{ display: 'none' }}
        onChange={handleFileSelect}
        accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.docx,.doc,.xlsx,.xls,.ppt,.pptx,.txt,.csv,.zip,.webm,.mp3,.wav,.ogg,.m4a,.opus,.mp4"
      />
      <input
        type="file"
        ref={imageInputRef}
        style={{ display: 'none' }}
        onChange={handleFileSelect}
        accept="image/*"
      />

      {/* Conversations & Channels List (Direct 3-column layout matching screenshot) */}
      <div className="teams-conversations-sidebar">
        {/* Header with Title "Chat" and "+ New Chat" Button */}
        <div className="teams-sidebar-top">
          <div className="teams-sidebar-header-row">
            <h2 className="teams-sidebar-title">
              <span>Chat</span>
            </h2>
            <button
              type="button"
              className="teams-new-chat-btn"
              onClick={() => {
                setModalTab('direct');
                setIsNewChatOpen(true);
              }}
              title="Compose new message or create group"
            >
              <Plus size={15} />
              <span>New Chat</span>
            </button>
          </div>

          {/* Search Box */}
          <div className="teams-search-box">
            <Search size={15} className="teams-search-icon" />
            <input
              type="text"
              placeholder="Search chats..."
              className="teams-search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                type="button"
                className="teams-search-clear"
                onClick={() => setSearchQuery('')}
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Filter Tabs matching Screenshot: All, Direct, Groups */}
        <div className="teams-filter-tabs">
          <button
            type="button"
            className={`teams-filter-tab ${activeTab === 'all' ? 'active' : ''}`}
            onClick={() => setActiveTab('all')}
          >
            All
          </button>
          <button
            type="button"
            className={`teams-filter-tab ${activeTab === 'direct' ? 'active' : ''}`}
            onClick={() => setActiveTab('direct')}
          >
            Direct
          </button>
          <button
            type="button"
            className={`teams-filter-tab ${activeTab === 'teams' ? 'active' : ''}`}
            onClick={() => setActiveTab('teams')}
          >
            Groups
          </button>
        </div>

        {/* Scrollable Conversation List */}
        <div className="teams-conversations-list">
          {isLoading ? (
            <div style={{ textAlign: 'center', padding: '32px 16px', color: '#64748b', fontSize: '0.85rem' }}>
              <Loader2 className="animate-spin" size={20} style={{ margin: '0 auto 8px auto', color: '#713DE5' }} />
              Loading conversations...
            </div>
          ) : filteredConversations.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px 16px', color: '#94a3b8', fontSize: '0.82rem' }}>
              No conversations found. Click <strong>New</strong> to start chatting!
            </div>
          ) : (
            filteredConversations.map((c) => {
              const isSelected = activeConversation?.conversation_id === c.conversation_id;
              const liveContact = c.type === 'direct' ? matchContact(c.target_id, c.title) : null;
              const isDirectOnline = c.type === 'direct'
                ? (liveContact?.is_online !== undefined ? Boolean(liveContact.is_online) : Boolean(c.is_online))
                : false;
              const directLastSeen = c.type === 'direct'
                ? pickLatestTimestamp(liveContact?.last_seen, c.last_seen)
                : null;
              const isDirectTyping = c.type === 'direct'
                ? Boolean(liveContact?.is_typing || c.is_typing) &&
                  (!c.conversation_id ||
                    !(liveContact?.typing_conversation_id || c.typing_conversation_id) ||
                    (liveContact?.typing_conversation_id || c.typing_conversation_id) === c.conversation_id)
                : false;
              const directStatusText = c.type === 'direct'
                ? formatLastSeen(directLastSeen, isDirectOnline, isDirectTyping)
                : '';

              return (
                <div
                  key={c.conversation_id}
                  className={`teams-conv-card ${isSelected ? 'selected' : ''}`}
                  onClick={() => {
                    const freshConv = c.type === 'direct' && liveContact ? {
                      ...c,
                      is_online: isDirectOnline,
                      last_seen: directLastSeen || c.last_seen,
                      profile_photo: liveContact.profile_photo || liveContact.photo_url || c.profile_photo || c.photo_url,
                      photo_url: liveContact.photo_url || liveContact.profile_photo || c.photo_url || c.profile_photo,
                    } : c;
                    if (activeConversation?.conversation_id !== c.conversation_id) {
                      setActiveConversation(freshConv);
                    }
                    setMobileShowChat(true);
                  }}
                >
                  <div className="teams-avatar-wrap">
                    {c.type === 'team' ? (
                      <div className="teams-avatar team">
                        <Hash size={18} />
                      </div>
                    ) : (
                      <>
                        <div className={`teams-avatar ${c.avatar === 'A' ? 'admin' : 'employee'}`}>
                          {liveContact?.profile_photo || liveContact?.photo_url || c.profile_photo || c.photo_url ? (
                            <img
                              src={liveContact?.profile_photo || liveContact?.photo_url || c.profile_photo || c.photo_url}
                              alt={c.title || 'Profile'}
                              className="teams-avatar-img"
                              onError={(e) => {
                                e.currentTarget.style.display = 'none';
                                const fb = e.currentTarget.parentElement?.querySelector('.teams-avatar-initial');
                                if (fb) fb.style.display = 'block';
                              }}
                            />
                          ) : null}
                          <span
                            className="teams-avatar-initial"
                            style={{ display: (liveContact?.profile_photo || liveContact?.photo_url || c.profile_photo || c.photo_url) ? 'none' : 'block' }}
                          >
                            {liveContact?.name?.charAt(0)?.toUpperCase() || c.avatar || c.title?.charAt(0)?.toUpperCase() || 'U'}
                          </span>
                        </div>
                        <div className={`teams-presence-dot ${isDirectOnline ? 'online' : 'offline'}`} />
                      </>
                    )}
                  </div>

                  <div className="teams-conv-content">
                    <div className="teams-conv-row">
                      <span className="teams-conv-title">{liveContact?.name || c.title}</span>
                      <span className="teams-conv-meta-badges">
                        {c.is_muted && (
                          <span className="teams-mute-indicator" title="Muted">
                            <BellOff size={12} />
                          </span>
                        )}
                        {c.is_pinned && (
                          <span className="teams-pin-indicator" title="Pinned chat">
                            <Pin size={12} />
                          </span>
                        )}
                        {c.type === 'direct' ? (
                          <span
                            className={`teams-conv-time ${isDirectOnline ? 'online-status' : ''}`}
                            style={
                              isDirectTyping
                                ? { color: '#713DE5', fontWeight: 600 }
                                : isDirectOnline
                                ? { color: '#22C55E', fontWeight: 600 }
                                : undefined
                            }
                            title={directStatusText}
                          >
                            {directStatusText}
                          </span>
                        ) : (
                          c.last_message_at && (
                            <span className="teams-conv-time">
                              {formatChatTime(c.last_message_at)}
                            </span>
                          )
                        )}
                      </span>
                    </div>
                    <div className="teams-conv-row">
                      <span className="teams-conv-snippet">
                        {c.last_message_sender ? `${c.last_message_sender}: ` : ''}
                        {c.last_message || 'Start a conversation'}
                      </span>
                      {c.unread_count > 0 && (
                        <span className="teams-unread-badge">
                          {c.unread_count > 99 ? '99+' : c.unread_count}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* 3. Center Main Chat Window */}
      {activeConversation ? (
        <div className="teams-main-chat">
          {/* Chat Header */}
          {/* Active Chat Header matching Screenshot (No call/video options) */}
          <div className="teams-chat-header">
            <div className="teams-chat-header-info">
              <button
                type="button"
                className="teams-mobile-back-btn"
                onClick={() => setMobileShowChat(false)}
                aria-label="Back to conversations"
                title="Back to conversations"
              >
                <ArrowLeft size={16} />
              </button>
              <div className="teams-avatar-wrap">
                {activeConversation.type === 'team' ? (
                  <div className="teams-avatar team">
                    <Users size={18} />
                  </div>
                ) : (
                  <>
                    <div className={`teams-avatar ${activeConversation.avatar === 'A' ? 'admin' : 'employee'}`}>
                      {activeConversation.profile_photo || activeConversation.photo_url ? (
                        <img
                          src={activeConversation.profile_photo || activeConversation.photo_url}
                          alt={activeConversation.title || 'Profile'}
                          className="teams-avatar-img"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                            const fb = e.currentTarget.parentElement?.querySelector('.teams-avatar-initial');
                            if (fb) fb.style.display = 'block';
                          }}
                        />
                      ) : null}
                      <span
                        className="teams-avatar-initial"
                        style={{ display: (activeConversation.profile_photo || activeConversation.photo_url) ? 'none' : 'block' }}
                      >
                        {activeConversation.avatar || activeConversation.title?.charAt(0)?.toUpperCase() || 'U'}
                      </span>
                    </div>
                    {(() => {
                      const liveContactDot = matchContact(activeConversation.target_id, activeConversation.title);
                      const isAvatarOnline =
                        liveContactDot?.is_online !== undefined
                          ? Boolean(liveContactDot.is_online)
                          : Boolean(activeConversation.is_online);
                      return <div className={`teams-presence-dot ${isAvatarOnline ? 'online' : 'offline'}`} />;
                    })()}
                  </>
                )}
              </div>
              <div>
                <div className="teams-chat-header-title">{activeConversation.title}</div>
                <div className="teams-chat-header-subtitle">
                  {activeConversation.type === 'team' ? (
                    (() => {
                      const onlineMembersCount = currentTeamObj?.members
                        ? currentTeamObj.members.filter((mId) => {
                            const key = String(mId || '').trim().toLowerCase();
                            return contacts.some(
                              (ct) =>
                                ct.is_online &&
                                [ct.id, ct.employee_id, ct.uid, ct.email, ct.name]
                                  .filter(Boolean)
                                  .some((k) => String(k).trim().toLowerCase() === key)
                            );
                          }).length
                        : 0;
                      const teamMemberLabel = currentTeamObj?.members?.length
                        ? `${currentTeamObj.members.length} members`
                        : activeConversation.subtitle || 'Team group';
                      return (
                        <>
                          <span>{teamMemberLabel}</span>
                          {onlineMembersCount > 0 && (
                            <>
                              <span className="teams-header-active-dot" />
                              <span style={{ color: '#22C55E', fontWeight: 600 }}>
                                {onlineMembersCount} online
                              </span>
                            </>
                          )}
                        </>
                      );
                    })()
                  ) : (
                    (() => {
                      const liveContact = matchContact(activeConversation.target_id, activeConversation.title);
                      const isOnline = liveContact?.is_online !== undefined
                        ? Boolean(liveContact.is_online)
                        : Boolean(activeConversation.is_online);
                      const lastSeen = pickLatestTimestamp(liveContact?.last_seen, activeConversation.last_seen);
                      const isMobileTyping =
                        Boolean(liveContact?.is_typing || activeConversation.is_typing) &&
                        (!activeConversation.conversation_id ||
                          !(liveContact?.typing_conversation_id || activeConversation.typing_conversation_id) ||
                          (liveContact?.typing_conversation_id || activeConversation.typing_conversation_id) === activeConversation.conversation_id);
                      const isTypingNow = Object.values(typingUsers).some(Boolean) || isMobileTyping;
                      const statusText = formatLastSeen(lastSeen, isOnline, isTypingNow);
                      if (isTypingNow) {
                        return <span style={{ color: '#713DE5', fontWeight: 600 }}>typing...</span>;
                      }
                      if (isOnline) {
                        return (
                          <>
                            <span className="teams-header-active-dot" />
                            <span style={{ color: '#22C55E', fontWeight: 600 }}>Online</span>
                          </>
                        );
                      }
                      return <span>{statusText}</span>;
                    })()
                  )}
                </div>
              </div>
            </div>

            {/* Header actions: Search & More Options Dropdown */}
            <div className="teams-chat-header-actions">
              <button
                type="button"
                className="teams-header-btn"
                title="Search messages in conversation"
              >
                <Search size={17} />
              </button>
              <div className="teams-header-menu-wrap" ref={headerMenuRef}>
                <button
                  type="button"
                  className={`teams-header-btn ${isHeaderMenuOpen || isDetailsOpen ? 'active' : ''}`}
                  onClick={() => setIsHeaderMenuOpen((prev) => !prev)}
                  title="Chat options"
                  aria-expanded={isHeaderMenuOpen}
                  aria-haspopup="menu"
                >
                  <MoreVertical size={17} />
                </button>
                {isHeaderMenuOpen && (
                  <div className="teams-header-dropdown" role="menu">
                    <button
                      type="button"
                      className="teams-header-dropdown-item"
                      role="menuitem"
                      onClick={() => {
                        setIsHeaderMenuOpen(false);
                        handleUpdateConversationPref(activeConversation, { pinned: !isPinned });
                      }}
                    >
                      <Pin size={15} />
                      <span>{isPinned ? 'Unpin chat' : 'Pin chat'}</span>
                      {isPinned && <span className="teams-header-dropdown-item-badge">Pinned</span>}
                    </button>
                    <button
                      type="button"
                      className="teams-header-dropdown-item"
                      role="menuitem"
                      onClick={() => {
                        setIsHeaderMenuOpen(false);
                        handleUpdateConversationPref(activeConversation, { muted: !isMuted });
                      }}
                    >
                      {isMuted ? <Bell size={15} /> : <BellOff size={15} />}
                      <span>{isMuted ? 'Unmute chat' : 'Mute chat'}</span>
                      {isMuted && <span className="teams-header-dropdown-item-badge">Muted</span>}
                    </button>
                    <button
                      type="button"
                      className="teams-header-dropdown-item"
                      role="menuitem"
                      onClick={handleOpenDetailsDrawer}
                    >
                      <Info size={15} />
                      <span>{activeConversation.type === 'team' ? 'Group info' : 'Contact info'}</span>
                    </button>
                    <div className="teams-header-dropdown-divider" />
                    <button
                      type="button"
                      className="teams-header-dropdown-item danger"
                      role="menuitem"
                      onClick={() => {
                        setIsHeaderMenuOpen(false);
                        setShowClearConfirm(true);
                      }}
                    >
                      <Trash2 size={15} />
                      <span>Clear chat</span>
                    </button>
                    <div className="teams-header-dropdown-divider" />
                    <button
                      type="button"
                      className="teams-header-dropdown-item danger"
                      role="menuitem"
                      onClick={() => {
                        setIsHeaderMenuOpen(false);
                        setShowDeleteForMeConfirm(true);
                      }}
                    >
                      <Trash2 size={15} />
                      <span>Delete for Me</span>
                    </button>
                    {canDeleteActiveGroup && (
                      <button
                        type="button"
                        className="teams-header-dropdown-item danger"
                        role="menuitem"
                        onClick={() => {
                          setIsHeaderMenuOpen(false);
                          setShowDeleteGroupConfirm(true);
                        }}
                      >
                        <Trash2 size={15} />
                        <span>Delete group</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Pinned Message Banner if Any */}
          {pinnedMessage && (
            <div className="teams-pinned-banner">
              <Pin size={14} color="#713DE5" />
              <div style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <strong>Pinned by {pinnedMessage.sender_name}:</strong> {pinnedMessage.content}
              </div>
              <button
                type="button"
                className="teams-action-icon-btn"
                onClick={() => handleTogglePin(pinnedMessage.id)}
                title="Unpin"
              >
                <X size={13} />
              </button>
            </div>
          )}

          {/* Messages Scroll Area */}
          <div className="teams-messages-area">
            {isMessagesLoading ? (
              <div className="teams-empty-messages">
                <Loader2 size={32} className="animate-spin" color="#713DE5" />
                <p style={{ marginTop: '10px', color: '#88839F' }}>Loading conversation...</p>
              </div>
            ) : messages.length === 0 ? (
              <div className="teams-empty-messages">
                <div className="teams-empty-messages-icon">
                  {activeConversation.type === 'team' ? <Hash size={40} /> : <MessageSquare size={40} />}
                </div>
                <h3>Welcome to #{activeConversation.title}!</h3>
                <p>This is the start of your real-time conversation. Send a message to get started.</p>
              </div>
            ) : (
              messages.map((msg) => {
                const isMine = myKeys.includes(String(msg.sender_id).trim().toLowerCase());

                return (
                  <div
                    key={msg.id}
                    className={`teams-msg-row ${isMine ? 'outgoing' : 'incoming'} ${
                      msg.sender_role === 'system' ? 'system-msg-row' : ''
                    }`}
                  >
                    {!isMine && msg.sender_role !== 'system' && (
                      <div className="teams-msg-avatar">
                        {msg.sender_avatar || msg.sender_name?.[0] || 'U'}
                      </div>
                    )}

                    <div className="teams-msg-body">
                      {msg.sender_role === 'system' ? (
                        <div style={{ textAlign: 'center', color: '#64748b', fontSize: '0.78rem', margin: '4px 0', fontStyle: 'italic' }}>
                          ⚙️ {msg.content}
                        </div>
                      ) : (
                        <>
                          <div className="teams-msg-header">
                            <span className="teams-msg-sender">{msg.sender_name}</span>
                            {msg.sender_role === 'admin' ? (
                              <span className="teams-role-pill admin">ADMIN</span>
                            ) : (
                              <span className="teams-role-pill employee">STAFF</span>
                            )}
                            <span className="teams-msg-timestamp">
                              {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                            {msg.is_edited && <span className="teams-msg-edited-tag">(edited)</span>}
                            {msg.is_pinned && <Pin size={12} color="#713DE5" />}
                          </div>

                          {/* Quoted Reply if any */}
                          {msg.reply_to && (
                            <div className="teams-quote-box">
                              <div className="teams-quote-author">{msg.reply_to.sender_name}</div>
                              <div className="teams-quote-text">{msg.reply_to.content_snippet}</div>
                            </div>
                          )}

                          {/* Main Message Bubble */}
                          <div className="teams-msg-bubble">
                            {(() => {
                              const hasAtt = msg.attachments && msg.attachments.length > 0;
                              const rawContent = String(msg.content || '').trim();
                              const firstAttName = hasAtt ? String(msg.attachments[0]?.filename || '').trim() : '';
                              const isPlaceholder =
                                hasAtt &&
                                (!rawContent ||
                                  rawContent === 'Photo' ||
                                  rawContent === '📷 Photo' ||
                                  rawContent === 'Voice message' ||
                                  rawContent === '🎤 Voice message' ||
                                  rawContent === 'Attachment' ||
                                  rawContent === firstAttName ||
                                  rawContent === `Shared: ${firstAttName}` ||
                                  (getAttachmentKind(msg.attachments[0]) === 'audio' && /^🎤?\s*Voice message/i.test(rawContent)));
                              return isPlaceholder ? null : rawContent;
                            })()}

                            {/* Render Attachments */}
                            {msg.attachments && msg.attachments.length > 0 && (
                              <div className="teams-attachment-container">
                                {msg.attachments.map((att, aIdx) => {
                                  const kind = getAttachmentKind(att);
                                  const sizeLabel = formatFileSize(att.file_size);
                                  if (kind === 'image') {
                                    return (
                                      <div
                                        key={aIdx}
                                        className="teams-attachment-img-wrap"
                                        onClick={() => setLightboxImage(att.url)}
                                        title="Click to view full image"
                                      >
                                        <img
                                          src={att.url}
                                          alt={att.filename || 'Photo'}
                                          className="teams-attachment-img"
                                          loading="lazy"
                                          onError={(e) => {
                                            e.currentTarget.style.display = 'none';
                                            const fb = e.currentTarget.nextElementSibling;
                                            if (fb) fb.style.display = 'flex';
                                          }}
                                        />
                                        <a
                                          href={att.url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          onClick={(ev) => ev.stopPropagation()}
                                          style={{
                                            display: 'none',
                                            alignItems: 'center',
                                            gap: '6px',
                                            padding: '8px 12px',
                                            borderRadius: '8px',
                                            backgroundColor: 'rgba(255,255,255,0.9)',
                                            color: '#334155',
                                            fontSize: '0.78rem',
                                            fontWeight: 600,
                                          }}
                                        >
                                          <ImageIcon size={16} />
                                          <span>{att.filename || 'Open Image'}</span>
                                        </a>
                                      </div>
                                    );
                                  }
                                  if (kind === 'audio') {
                                    const durMs = Number(att.duration_ms || 0);
                                    const durSec = durMs > 0 ? Math.max(1, Math.round(durMs / 1000)) : 0;
                                    const durLabel = durSec > 0
                                      ? `${Math.floor(durSec / 60)}:${durSec % 60 < 10 ? '0' : ''}${durSec % 60}`
                                      : '';
                                    return (
                                      <div
                                        key={aIdx}
                                        className="teams-voice-note-card"
                                        style={{
                                          marginTop: '6px',
                                          padding: '8px 12px',
                                          borderRadius: '12px',
                                          backgroundColor: isMine ? 'rgba(255, 255, 255, 0.18)' : '#F0ECFA',
                                          border: isMine ? '1px solid rgba(255, 255, 255, 0.28)' : '1px solid #E9E1F5',
                                          display: 'flex',
                                          flexDirection: 'column',
                                          gap: '6px',
                                          minWidth: '220px',
                                          maxWidth: '300px',
                                        }}
                                      >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', fontWeight: 700, color: isMine ? '#ffffff' : '#713DE5' }}>
                                          <Volume2 size={15} />
                                          <span>
                                            {att.filename || 'Voice Message'}
                                            {durLabel && !String(att.filename || '').includes('(') ? ` (${durLabel})` : ''}
                                          </span>
                                        </div>
                                        <audio
                                          controls
                                          preload="metadata"
                                          src={att.url}
                                          style={{ width: '100%', height: '32px', outline: 'none' }}
                                        />
                                      </div>
                                    );
                                  }
                                  const fname = (att.filename || getUrlExt(att.url) || '').toLowerCase();
                                  const isPdf = fname.endsWith('.pdf');
                                  const isWord = fname.endsWith('.doc') || fname.endsWith('.docx');
                                  const isExcel = fname.endsWith('.xls') || fname.endsWith('.xlsx') || fname.endsWith('.csv');
                                  const isPpt = fname.endsWith('.ppt') || fname.endsWith('.pptx');
                                  const isCodeOrZip = fname.endsWith('.zip') || fname.endsWith('.rar') || fname.endsWith('.js') || fname.endsWith('.json');
                                  const badgeBg = isPdf ? '#fee2e2' : isWord ? '#dbeafe' : isExcel ? '#dcfce7' : isPpt ? '#ffedd5' : isCodeOrZip ? '#e0f2fe' : '#e0e7ff';
                                  const badgeColor = isPdf ? '#dc2626' : isWord ? '#2563eb' : isExcel ? '#15803d' : isPpt ? '#ea580c' : isCodeOrZip ? '#0284c7' : '#4f46e5';
                                  const badgeText = isPdf ? 'PDF' : isWord ? 'DOC' : isExcel ? 'XLS' : isPpt ? 'PPT' : isCodeOrZip ? 'ZIP' : null;
                                  return (
                                    <a
                                      key={aIdx}
                                      href={att.url}
                                      download={att.filename}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="teams-attachment-card"
                                    >
                                      <div
                                        className="teams-attachment-card-icon"
                                        style={{
                                          backgroundColor: badgeBg,
                                          color: badgeColor,
                                          fontWeight: 800,
                                          fontSize: '0.68rem',
                                          borderRadius: '6px',
                                          minWidth: '34px',
                                          height: '34px',
                                          display: 'flex',
                                          alignItems: 'center',
                                          justifyContent: 'center',
                                        }}
                                      >
                                        {badgeText || <FileText size={16} />}
                                      </div>
                                      <div className="teams-attachment-card-info">
                                        <span className="teams-attachment-card-name">{att.filename || 'Document'}</span>
                                        {sizeLabel ? (
                                          <span className="teams-attachment-card-size">{sizeLabel}</span>
                                        ) : (
                                          <span className="teams-attachment-card-size">Tap to open</span>
                                        )}
                                      </div>
                                      <Download size={15} style={{ marginLeft: 'auto', color: '#64748b' }} />
                                    </a>
                                  );
                                })}
                              </div>
                            )}
                          </div>

                          {/* Reactions Pills */}
                          {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                            <div className="teams-msg-reactions">
                              {Object.entries(msg.reactions).map(([emoji, usersList]) => {
                                const hasReacted = usersList.includes(myPrimaryId);
                                return (
                                  <button
                                    key={emoji}
                                    type="button"
                                    className={`teams-reaction-pill ${hasReacted ? 'reacted' : ''}`}
                                    onClick={() => handleToggleReaction(msg.id, emoji)}
                                    title={`Reacted by: ${usersList.join(', ')}`}
                                  >
                                    <span>{emoji}</span>
                                    <span>{usersList.length}</span>
                                  </button>
                                );
                              })}
                            </div>
                          )}

                          {/* Delivery status */}
                          {isMine && (
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '3px',
                                marginTop: '2px',
                                color: '#94a3b8',
                                fontSize: '0.7rem',
                              }}
                            >
                              <CheckCheck size={13} color="#713DE5" />
                              <span>Delivered</span>
                            </div>
                          )}
                        </>
                      )}
                    </div>

                    {/* Hover Reaction & Actions Menu */}
                    {msg.sender_role !== 'system' && (
                      <div className="teams-msg-actions-hover">
                        {EMOJIS.slice(0, 4).map((em) => (
                          <button
                            key={em}
                            type="button"
                            className="teams-action-icon-btn"
                            onClick={() => handleToggleReaction(msg.id, em)}
                            title={`React with ${em}`}
                          >
                            {em}
                          </button>
                        ))}

                        <button
                          type="button"
                          className="teams-action-icon-btn"
                          onClick={() => {
                            setReplyingTo(msg);
                            setEditingMessage(null);
                            if (textareaRef.current) textareaRef.current.focus();
                          }}
                          title="Reply to message"
                        >
                          <Reply size={13} />
                        </button>

                        {(isMine || isAdmin) && (
                          <button
                            type="button"
                            className="teams-action-icon-btn"
                            onClick={() => handleStartEdit(msg)}
                            title="Edit message"
                          >
                            <Edit2 size={13} />
                          </button>
                        )}

                        <button
                          type="button"
                          className="teams-action-icon-btn"
                          onClick={() => handleTogglePin(msg.id)}
                          title={msg.is_pinned ? 'Unpin' : 'Pin message'}
                        >
                          <Pin size={13} />
                        </button>

                        {(isMine || isAdmin) && (
                          <button
                            type="button"
                            className="teams-action-icon-btn"
                            onClick={() => handleDeleteMessage(msg.id)}
                            title="Delete message"
                            style={{ color: '#ef4444' }}
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Typing Indicator Bar */}
          {typingNames.length > 0 && (
            <div className="teams-typing-bar">
              <div className="teams-typing-dots">
                <span className="teams-typing-dot" />
                <span className="teams-typing-dot" />
                <span className="teams-typing-dot" />
              </div>
              <span>
                {typingNames.join(', ')} {typingNames.length > 1 ? 'are' : 'is'} typing...
              </span>
            </div>
          )}

          {/* Input & Formatter Area */}
          <div className="teams-input-container">
            {/* Quick Replies Row */}
            <div className="teams-quick-replies">
              {QUICK_REPLIES.map((qr, idx) => (
                <button
                  key={idx}
                  type="button"
                  className="teams-quick-chip"
                  onClick={() => setInputMessage(qr)}
                >
                  {qr}
                </button>
              ))}
            </div>

            {/* Quoting Preview if User Clicked Reply */}
            {replyingTo && (
              <div className="teams-replying-bar">
                <div>
                  <strong>Replying to {replyingTo.sender_name}:</strong>{' '}
                  <span style={{ opacity: 0.85 }}>{replyingTo.content.substring(0, 60)}...</span>
                </div>
                <button
                  type="button"
                  onClick={() => setReplyingTo(null)}
                  style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer' }}
                >
                  <X size={14} />
                </button>
              </div>
            )}

            {/* Editing Message Banner */}
            {editingMessage && (
              <div className="teams-editing-bar">
                <div>
                  <strong>Editing message</strong> • Press Esc to cancel
                </div>
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer' }}
                >
                  <X size={14} />
                </button>
              </div>
            )}

            {/* Attached file preview chip in composer */}
            {attachedFile && (
              <div className="teams-composer-attachment-preview">
                {getAttachmentKind(attachedFile) === 'image' && attachedFile.url ? (
                  <img
                    src={attachedFile.url}
                    alt={attachedFile.filename}
                    style={{ width: '36px', height: '36px', borderRadius: '6px', objectFit: 'cover' }}
                  />
                ) : (
                  <FileText size={16} />
                )}
                <span style={{ fontWeight: 600 }}>{attachedFile.filename}</span>
                {formatFileSize(attachedFile.file_size) && (
                  <span style={{ fontSize: '0.75rem', opacity: 0.75 }}>
                    ({formatFileSize(attachedFile.file_size)})
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setAttachedFile(null)}
                  style={{
                    marginLeft: 'auto',
                    background: 'transparent',
                    border: 'none',
                    color: '#dc2626',
                    cursor: 'pointer',
                  }}
                  title="Remove attachment"
                >
                  <X size={15} />
                </button>
              </div>
            )}

            <form onSubmit={handleSendMessage} className="teams-input-box">
              <textarea
                ref={textareaRef}
                rows={2}
                className="teams-textarea"
                placeholder={
                  editingMessage
                    ? 'Edit your message...'
                    : `Type a message to ${activeConversation.title}... (Shift+Enter for newline)`
                }
                value={inputMessage}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                onPaste={handleComposerPaste}
              />

              <div className="teams-input-toolbar">
                {isRecording ? (
                  <div
                    className="teams-voice-recording-bar"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      width: '100%',
                      padding: '4px 6px',
                      borderRadius: '8px',
                      backgroundColor: '#fef2f2',
                      border: '1px solid #fecaca',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#dc2626', fontWeight: 700, fontSize: '0.85rem' }}>
                      <span className="voice-record-pulse" style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#ef4444', display: 'inline-block' }} />
                      <span>Recording voice note... {Math.floor(recordingDuration / 60)}:{recordingDuration % 60 < 10 ? '0' : ''}{recordingDuration % 60}</span>
                    </div>

                    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <button
                        type="button"
                        onClick={cancelRecording}
                        className="teams-tool-btn"
                        style={{ color: '#ef4444' }}
                        title="Discard voice recording"
                        disabled={isSendingVoice}
                      >
                        <Trash2 size={16} />
                      </button>

                      <button
                        type="button"
                        onClick={stopAndSendVoiceMessage}
                        className="teams-send-btn"
                        style={{ height: '32px' }}
                        title="Send voice note"
                        disabled={isSendingVoice}
                      >
                        {isSendingVoice ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <>
                            <Send size={14} />
                            <span>Send</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="teams-toolbar-left">
                      <button
                        type="button"
                        className="teams-tool-btn"
                        onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                        title="Insert Emoji"
                      >
                        <Smile size={18} />
                      </button>

                      <button
                        type="button"
                        className="teams-tool-btn"
                        onClick={() => imageInputRef.current?.click()}
                        disabled={isUploading}
                        title="Send Photo / Image"
                      >
                        <ImageIcon size={18} />
                      </button>

                      <button
                        type="button"
                        className="teams-tool-btn"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isUploading}
                        title="Attach document or file (PDF, Word, Excel, PPT, Audio)"
                      >
                        {isUploading ? <Loader2 size={18} className="animate-spin" /> : <Paperclip size={18} />}
                      </button>

                      {/* Voice message button matching user's Image 2 */}
                      <button
                        type="button"
                        className="teams-tool-btn voice-mic-btn"
                        onClick={startRecording}
                        title="Record and send voice message"
                      >
                        <Mic size={18} />
                      </button>
                    </div>

                    <button
                      type="submit"
                      disabled={(!inputMessage.trim() && !attachedFile) || isSending}
                      className="teams-send-btn"
                    >
                      {isSending ? (
                        <Loader2 size={15} className="animate-spin" />
                      ) : editingMessage ? (
                        <span>Save</span>
                      ) : (
                        <>
                          <Send size={15} />
                          <span>Send</span>
                        </>
                      )}
                    </button>
                  </>
                )}
              </div>
            </form>

            {/* Quick Floating Emoji Picker */}
            {showEmojiPicker && (
              <div
                style={{
                  position: 'absolute',
                  bottom: '90px',
                  left: '24px',
                  backgroundColor: '#ffffff',
                  border: '1px solid #e2e8f0',
                  borderRadius: '12px',
                  padding: '8px',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                  display: 'flex',
                  gap: '8px',
                  zIndex: 20,
                }}
              >
                {EMOJIS.map((em) => (
                  <button
                    key={em}
                    type="button"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      fontSize: '1.25rem',
                      cursor: 'pointer',
                      padding: '4px',
                    }}
                    onClick={() => {
                      setInputMessage((prev) => prev + em);
                      setShowEmojiPicker(false);
                    }}
                  >
                    {em}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>
          Select or start a conversation
        </div>
      )}

      {/* 4. Right Side Details Drawer: Group Information or Contact Information */}
      {isDetailsOpen && activeConversation && (
        <div className="teams-details-drawer">
          <div className="teams-drawer-header">
            <h4 className="teams-drawer-title">
              {activeConversation.type === 'team' ? 'Group Information' : 'Contact Information'}
            </h4>
            <button
              type="button"
              onClick={() => setIsDetailsOpen(false)}
              style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', padding: '4px' }}
              title="Close panel"
            >
              <X size={18} />
            </button>
          </div>

          <div className="teams-profile-card">
            <div className="teams-profile-avatar-big" style={{ overflow: 'hidden' }}>
              {activeConversation.type === 'team' ? (
                <Users size={32} />
              ) : (activeConversation.profile_photo || activeConversation.photo_url) ? (
                <img
                  src={activeConversation.profile_photo || activeConversation.photo_url}
                  alt={activeConversation.title}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                activeConversation.avatar || activeConversation.title?.charAt(0)?.toUpperCase() || 'U'
              )}
            </div>
            <div className="teams-profile-name" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
              <span>{activeConversation.title}</span>
              {activeConversation.type === 'team' && (
                <Edit2
                  size={13}
                  style={{ cursor: 'pointer', color: '#88839F' }}
                  title="Edit group name"
                  onClick={handleEditGroupName}
                />
              )}
            </div>
            <div className="teams-profile-role" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', flexWrap: 'wrap' }}>
              {activeConversation.type === 'team' ? (
                <span>
                  {currentTeamObj?.members?.length
                    ? `${currentTeamObj.members.length} members`
                    : activeConversation.subtitle || 'Team group'}
                </span>
              ) : (
                (() => {
                  const cObj = matchContact(activeConversation.target_id, activeConversation.title);
                  const onlineNow = cObj?.is_online !== undefined ? Boolean(cObj.is_online) : Boolean(activeConversation.is_online);
                  const lastSeenVal = pickLatestTimestamp(cObj?.last_seen, activeConversation.last_seen);
                  return (
                    <>
                      <span>{activeConversation.subtitle || cObj?.department || 'Employee'}</span>
                      <span>•</span>
                      {onlineNow && <span className="teams-header-active-dot" />}
                      <span style={{ color: onlineNow ? '#22C55E' : '#64748b', fontWeight: onlineNow ? 600 : 500 }}>
                        {formatLastSeen(lastSeenVal, onlineNow, false)}
                      </span>
                    </>
                  );
                })()
              )}
            </div>

            {/* Quick Actions (Call & Video options removed per instruction) */}
            <div className="teams-drawer-actions-grid" style={{ display: 'flex', justifyContent: 'center', gap: '14px', marginTop: '16px' }}>
              {activeConversation.type === 'team' && (
                <button
                  type="button"
                  className="teams-info-action-btn"
                  onClick={() => setShowAddMemberSelect(!showAddMemberSelect)}
                  title="Add members to group"
                >
                  <div className="teams-info-action-icon">
                    <UserPlus size={16} />
                  </div>
                  <span>Add Members</span>
                </button>
              )}

              <button
                type="button"
                className="teams-info-action-btn"
                onClick={() => handleUpdateConversationPref(activeConversation, { muted: !isMuted })}
                title={isMuted ? 'Unmute notifications' : 'Mute notifications'}
              >
                <div className="teams-info-action-icon">
                  {isMuted ? <BellOff size={16} /> : <Bell size={16} />}
                </div>
                <span>{isMuted ? 'Muted' : 'Mute'}</span>
              </button>
            </div>
          </div>

          {/* About Section */}
          <div className="teams-details-section" style={{ borderBottom: '1px solid #E9E1F5', paddingBottom: '14px', marginBottom: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
              <div className="teams-details-section-title" style={{ margin: 0 }}>About</div>
              {activeConversation.type === 'team' && (
                <Edit2
                  size={12}
                  style={{ color: '#88839F', cursor: 'pointer' }}
                  title="Edit group description"
                  onClick={handleEditGroupDescription}
                />
              )}
            </div>
            <div style={{ fontSize: '0.82rem', color: '#88839F', lineHeight: 1.45 }}>
              {currentTeamObj?.description || 'Discuss product development, tasks, updates and releases.'}
            </div>
          </div>

          {/* Details Tabs: Members (team only) | Shared Files | Pinned Messages */}
          <div className="teams-drawer-tabs" style={{ display: 'flex', borderBottom: '1px solid #E9E1F5', marginBottom: '14px' }}>
            {activeConversation.type === 'team' && (
              <button
                type="button"
                className={`teams-drawer-tab ${detailsTab === 'members' ? 'active' : ''}`}
                onClick={() => setDetailsTab('members')}
                style={{
                  flex: 1,
                  padding: '8px 0',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: detailsTab === 'members' ? '2.5px solid #713DE5' : '2.5px solid transparent',
                  color: detailsTab === 'members' ? '#713DE5' : '#88839F',
                  fontWeight: detailsTab === 'members' ? 700 : 600,
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                }}
              >
                Members ({currentTeamObj?.members?.length || 0})
              </button>
            )}
            <button
              type="button"
              className={`teams-drawer-tab ${detailsTab === 'files' ? 'active' : ''}`}
              onClick={() => setDetailsTab('files')}
              style={{
                flex: 1,
                padding: '8px 0',
                background: 'transparent',
                border: 'none',
                borderBottom: detailsTab === 'files' ? '2.5px solid #713DE5' : '2.5px solid transparent',
                color: detailsTab === 'files' ? '#713DE5' : '#88839F',
                fontWeight: detailsTab === 'files' ? 700 : 600,
                fontSize: '0.8rem',
                cursor: 'pointer',
              }}
            >
              Shared Files
            </button>
            <button
              type="button"
              className={`teams-drawer-tab ${detailsTab === 'pinned' ? 'active' : ''}`}
              onClick={() => setDetailsTab('pinned')}
              style={{
                flex: 1,
                padding: '8px 0',
                background: 'transparent',
                border: 'none',
                borderBottom: detailsTab === 'pinned' ? '2.5px solid #713DE5' : '2.5px solid transparent',
                color: detailsTab === 'pinned' ? '#713DE5' : '#88839F',
                fontWeight: detailsTab === 'pinned' ? 700 : 600,
                fontSize: '0.8rem',
                cursor: 'pointer',
              }}
            >
              Pinned
            </button>
          </div>

          {/* Tab 1: Members List (Team chats only) */}
          {detailsTab === 'members' && activeConversation.type === 'team' && (
            <div className="teams-details-section">
              {showAddMemberSelect && (
                <div style={{ background: '#f8fafc', padding: '10px', borderRadius: '8px', marginBottom: '12px', border: '1px solid #e2e8f0' }}>
                  <select
                    value={selectedAddMemberId}
                    onChange={(e) => setSelectedAddMemberId(e.target.value)}
                    style={{ width: '100%', padding: '6px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.82rem', marginBottom: '8px' }}
                  >
                    <option value="">Select Employee to add...</option>
                    {contacts
                      .filter((c) => {
                        const existingNames = new Set((currentTeamObj?.members || []).map((m) => String(m).trim().toLowerCase()).filter(Boolean));
                        const existingUids = new Set((currentTeamObj?.member_ids || currentTeamObj?.memberIds || []).map((u) => String(u).trim().toLowerCase()).filter(Boolean));
                        const cUid = String(c.uid || '').trim().toLowerCase();
                        const cEmpId = String(c.employee_id || c.id || '').trim().toLowerCase();
                        const cName = String(c.name || '').trim().toLowerCase();
                        return !(cUid && existingUids.has(cUid)) && !(cName && existingNames.has(cName)) && !(cEmpId && existingNames.has(cEmpId));
                      })
                      .map((c) => (
                        <option key={c.id} value={c.uid || c.employee_id || c.id}>
                          {c.name} ({c.department})
                        </option>
                      ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleAddMemberToCurrentGroup}
                    disabled={!selectedAddMemberId}
                    style={{
                      width: '100%',
                      padding: '8px',
                      background: 'linear-gradient(135deg, #6739E8 0%, #A43CE0 100%)',
                      color: '#ffffff',
                      borderRadius: '6px',
                      border: 'none',
                      fontWeight: 700,
                      fontSize: '0.78rem',
                      cursor: 'pointer',
                    }}
                  >
                    Confirm Add to Group
                  </button>
                </div>
              )}

              {/* Members List with Live Presence Status */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '280px', overflowY: 'auto' }}>
                {(currentTeamObj?.members && currentTeamObj.members.length > 0) ? (
                  currentTeamObj.members.map((mId) => {
                    const key = String(mId || '').trim().toLowerCase();
                    const c = contacts.find((ct) =>
                      [ct.id, ct.employee_id, ct.uid, ct.email, ct.name]
                        .filter(Boolean)
                        .some((k) => String(k).trim().toLowerCase() === key)
                    );
                    const isOnline = Boolean(c?.is_online);
                    return {
                      id: mId,
                      name: c?.name || mId,
                      role: mId === currentTeamObj?.leader ? 'Admin' : 'Member',
                      status: formatLastSeen(c?.last_seen, isOnline, false),
                      isOnline,
                      photo: c?.profile_photo || c?.photo_url || null,
                    };
                  }).map((mem, idx) => {
                    const statusColor = mem.isOnline ? '#22C55E' : '#94a3b8';

                    return (
                      <div
                        key={mem.id || idx}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '6px 4px',
                          fontSize: '0.82rem',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <div
                            style={{
                              width: '32px',
                              height: '32px',
                              borderRadius: '50%',
                              backgroundColor: '#e2e8f0',
                              color: '#1e293b',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: '0.8rem',
                              fontWeight: 700,
                              overflow: 'hidden',
                            }}
                          >
                            {mem.photo ? (
                              <img
                                src={mem.photo}
                                alt={mem.name}
                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                onError={(e) => { e.currentTarget.style.display = 'none'; }}
                              />
                            ) : (
                              mem.name.charAt(0).toUpperCase()
                            )}
                          </div>
                          <div>
                            <div style={{ fontWeight: 700, color: '#0f172a' }}>{mem.name}</div>
                            <div style={{ fontSize: '0.72rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <span>{mem.role}</span>
                              <span>•</span>
                              <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: statusColor, display: 'inline-block' }} />
                              <span>{mem.status}</span>
                            </div>
                          </div>
                        </div>

                        <MoreVertical size={14} style={{ color: '#94a3b8', cursor: 'pointer' }} />
                      </div>
                    );
                  })
                ) : (
                  <div style={{ fontSize: '0.8rem', color: '#94a3b8', textAlign: 'center', padding: '16px 0' }}>
                    No member list available.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Tab 2: Shared Files */}
          {detailsTab === 'files' && (
            <div className="teams-details-section">
              {sharedAttachments.length === 0 ? (
                <div style={{ fontSize: '0.8rem', color: '#94a3b8', textAlign: 'center', padding: '20px 0' }}>
                  No shared files yet.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {sharedAttachments.map((att, aIdx) => (
                    <a
                      key={aIdx}
                      href={att.url}
                      download={att.filename}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '8px',
                        borderRadius: '8px',
                        border: '1px solid #e2e8f0',
                        fontSize: '0.78rem',
                        color: '#1e293b',
                      }}
                    >
                      <FileText size={16} color="#713DE5" />
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {att.filename}
                      </span>
                      <Download size={13} color="#88839F" />
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Tab 3: Pinned Messages */}
          {detailsTab === 'pinned' && (
            <div className="teams-details-section">
              {pinnedMessage ? (
                <div style={{ padding: '10px', backgroundColor: '#FAF7FF', borderRadius: '8px', border: '1px solid #E9E1F5', fontSize: '0.8rem' }}>
                  <div style={{ fontWeight: 700, color: '#713DE5', marginBottom: '4px' }}>
                    {pinnedMessage.sender_name}
                  </div>
                  <div>{pinnedMessage.content}</div>
                </div>
              ) : (
                <div style={{ fontSize: '0.8rem', color: '#94a3b8', textAlign: 'center', padding: '20px 0' }}>
                  No pinned messages.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 5. "New Chat" & "New Group" Modal */}
      {isNewChatOpen && (
        <div className="teams-modal-backdrop" onClick={() => setIsNewChatOpen(false)}>
          <div className="teams-modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '480px' }}>
            <div className="teams-modal-header">
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#0f172a' }}>
                New Message or Group
              </h3>
              <button
                type="button"
                onClick={() => setIsNewChatOpen(false)}
                style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Tabs: Direct Chat vs Create Team Channel */}
            <div className="teams-modal-tabs">
              <button
                type="button"
                className={`teams-modal-tab-btn ${modalTab === 'direct' ? 'active' : ''}`}
                onClick={() => setModalTab('direct')}
              >
                Direct Message
              </button>
              <button
                type="button"
                className={`teams-modal-tab-btn ${modalTab === 'group' ? 'active' : ''}`}
                onClick={() => setModalTab('group')}
              >
                Create Team Group
              </button>
            </div>

            <div className="teams-modal-body" style={{ maxHeight: '420px', overflowY: 'auto' }}>
              {modalTab === 'direct' ? (
                <>
                  <input
                    type="text"
                    placeholder="Search employees, admins, or team channels..."
                    value={newChatSearch}
                    onChange={(e) => setNewChatSearch(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      border: '1px solid #cbd5e1',
                      fontSize: '0.85rem',
                      marginBottom: '14px',
                    }}
                  />

                  {/* Team Channels Section */}
                  <div
                    style={{
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      color: '#64748b',
                      textTransform: 'uppercase',
                      marginBottom: '8px',
                    }}
                  >
                    Existing Team Channels
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '18px' }}>
                    {(() => {
                      const q = newChatSearch.trim().toLowerCase();
                      const filteredTeams = teams.filter(
                        (t) =>
                          !q ||
                          (t.name || '').toLowerCase().includes(q) ||
                          (t.department || '').toLowerCase().includes(q)
                      );
                      if (filteredTeams.length === 0) {
                        return (
                          <div style={{ padding: '10px 12px', fontSize: '0.82rem', color: '#94a3b8' }}>
                            {isLoading ? 'Loading team channels...' : 'No team channels available.'}
                          </div>
                        );
                      }
                      return filteredTeams.map((t) => (
                        <div key={t.id} className="teams-modal-item" onClick={() => handleSelectTeamChannel(t)}>
                          <div
                            className="teams-avatar team"
                            style={{ width: '32px', height: '32px', borderRadius: '8px' }}
                          >
                            <Hash size={16} />
                          </div>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#0f172a' }}>{t.name}</div>
                            <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                              {t.department} &bull; {t.member_count} members
                            </div>
                          </div>
                        </div>
                      ));
                    })()}
                  </div>

                  {/* Individual Contacts Section */}
                  <div
                    style={{
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      color: '#64748b',
                      textTransform: 'uppercase',
                      marginBottom: '8px',
                    }}
                  >
                    Direct Message (Employees & Admins)
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {(() => {
                      const q = newChatSearch.trim().toLowerCase();
                      const filteredContacts = contacts.filter(
                        (c) =>
                          !isSampleExcludedChatMember(c) &&
                          (!q ||
                          (c.name || '').toLowerCase().includes(q) ||
                          (c.email || '').toLowerCase().includes(q) ||
                          (c.employee_id || '').toLowerCase().includes(q) ||
                          (c.department || '').toLowerCase().includes(q))
                      );
                      if (filteredContacts.length === 0) {
                        return (
                          <div style={{ padding: '10px 12px', fontSize: '0.82rem', color: '#94a3b8' }}>
                            {isLoading ? 'Loading employees...' : 'No matching employees found.'}
                          </div>
                        );
                      }
                      return filteredContacts.map((c) => (
                        <div key={c.id} className="teams-modal-item" onClick={() => handleStartChatWithContact(c)}>
                          <div className="teams-avatar-wrap" style={{ width: '32px', height: '32px' }}>
                            <div
                              className={`teams-avatar ${c.role}`}
                              style={{ width: '32px', height: '32px', borderRadius: '8px', fontSize: '0.85rem' }}
                            >
                              {c.profile_photo || c.photo_url ? (
                                <img
                                  src={c.profile_photo || c.photo_url}
                                  alt={c.name || 'User'}
                                  className="teams-avatar-img"
                                  style={{ borderRadius: '8px' }}
                                  onError={(e) => {
                                    e.currentTarget.style.display = 'none';
                                    const fb = e.currentTarget.parentElement?.querySelector('.teams-avatar-initial');
                                    if (fb) fb.style.display = 'block';
                                  }}
                                />
                              ) : null}
                              <span
                                className="teams-avatar-initial"
                                style={{ display: (c.profile_photo || c.photo_url) ? 'none' : 'block' }}
                              >
                                {c.avatar || c.name?.charAt(0)?.toUpperCase() || 'U'}
                              </span>
                            </div>
                            <div className={`teams-presence-dot ${c.is_online ? 'online' : 'offline'}`} />
                          </div>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#0f172a' }}>
                              {c.name} {c.role === 'admin' ? '(Admin)' : ''}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                              {c.designation} &bull; {c.department}
                            </div>
                          </div>
                        </div>
                      ));
                    })()}
                  </div>
                </>
              ) : (
                /* Group Creation Form */
                <form onSubmit={handleCreateGroup} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                      Group Name *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g., Engineering Team, Project Titan"
                      value={newGroupName}
                      onChange={(e) => setNewGroupName(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        borderRadius: '8px',
                        border: '1px solid #cbd5e1',
                        fontSize: '0.88rem',
                      }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                      Description (Optional)
                    </label>
                    <input
                      type="text"
                      placeholder="Purpose of this group conversation..."
                      value={newGroupDescription}
                      onChange={(e) => setNewGroupDescription(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        borderRadius: '8px',
                        border: '1px solid #cbd5e1',
                        fontSize: '0.88rem',
                      }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                      Add Members ({selectedGroupMembers.length} selected)
                    </label>
                    <input
                      type="text"
                      placeholder="Search employees..."
                      value={groupMemberSearch}
                      onChange={(e) => setGroupMemberSearch(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '6px 10px',
                        borderRadius: '6px',
                        border: '1px solid #e2e8f0',
                        fontSize: '0.8rem',
                        marginBottom: '8px',
                      }}
                    />

                    <div style={{ maxHeight: '150px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '6px' }}>
                      {(() => {
                        const mySelfKeys = new Set(
                          [
                            myPrimaryId,
                            currentUser?.uid,
                            currentUser?.employee_id,
                            currentUser?.email,
                          ]
                            .filter(Boolean)
                            .map((k) => String(k).trim().toLowerCase())
                        );
                        const filteredGroupContacts = contacts.filter((c) => {
                          if (isSampleExcludedChatMember(c)) return false;
                          const cKeys = [c.id, c.employee_id, c.uid, c.email]
                            .filter(Boolean)
                            .map((k) => String(k).trim().toLowerCase());
                          if (cKeys.some((k) => mySelfKeys.has(k))) return false;
                          return (
                            !groupMemberSearch ||
                            (c.name || '').toLowerCase().includes(groupMemberSearch.toLowerCase()) ||
                            (c.department || '').toLowerCase().includes(groupMemberSearch.toLowerCase()) ||
                            (c.employee_id || '').toLowerCase().includes(groupMemberSearch.toLowerCase())
                          );
                        });
                        if (filteredGroupContacts.length === 0) {
                          return (
                            <div style={{ padding: '10px', fontSize: '0.82rem', color: '#94a3b8', textAlign: 'center' }}>
                              {isLoading ? 'Loading employees...' : 'No matching employees found.'}
                            </div>
                          );
                        }
                        return filteredGroupContacts.map((c) => {
                          const isSelected = selectedGroupMembers.includes(c.employee_id || c.id);
                          return (
                            <div
                              key={c.id}
                              onClick={() => handleToggleMemberSelection(c.employee_id || c.id)}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                padding: '6px 8px',
                                borderRadius: '6px',
                                cursor: 'pointer',
                                backgroundColor: isSelected ? '#F0E9FF' : 'transparent',
                              }}
                            >
                              <div
                                style={{
                                  width: '18px',
                                  height: '18px',
                                  borderRadius: '4px',
                                  border: isSelected ? '1px solid #713DE5' : '1px solid #E9E1F5',
                                  backgroundColor: isSelected ? '#713DE5' : '#ffffff',
                                  color: '#ffffff',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                }}
                              >
                                {isSelected && <Check size={12} />}
                              </div>
                              <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#24213B' }}>{c.name}</span>
                              <span style={{ fontSize: '0.72rem', color: '#88839F', marginLeft: 'auto' }}>
                                {c.department}
                              </span>
                            </div>
                          );
                        });
                      })()}
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={!newGroupName.trim() || isCreatingGroup}
                    style={{
                      width: '100%',
                      padding: '10px',
                      background: 'linear-gradient(135deg, #6739E8 0%, #A43CE0 100%)',
                      color: '#ffffff',
                      borderRadius: '8px',
                      border: 'none',
                      fontWeight: 700,
                      fontSize: '0.9rem',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                    }}
                  >
                    {isCreatingGroup ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                    <span>Create Group Channel</span>
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 6. Clear Chat Confirmation Modal */}
      {showClearConfirm && activeConversation && (
        <div
          className="teams-modal-backdrop"
          onClick={() => !isClearingChat && setShowClearConfirm(false)}
        >
          <div className="teams-confirm-modal-card" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: '#24213B' }}>
              Clear chat history?
            </h3>
            <p style={{ margin: '10px 0 0', fontSize: '0.86rem', color: '#64748b', lineHeight: 1.5 }}>
              All messages in <strong>{activeConversation.title}</strong> will be cleared for you only.
              Other participants will still see this chat.
            </p>
            <div className="teams-confirm-modal-actions">
              <button
                type="button"
                className="teams-confirm-cancel-btn"
                onClick={() => setShowClearConfirm(false)}
                disabled={isClearingChat}
              >
                Cancel
              </button>
              <button
                type="button"
                className="teams-confirm-danger-btn"
                onClick={handleConfirmClearChat}
                disabled={isClearingChat}
              >
                {isClearingChat ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                <span>{isClearingChat ? 'Clearing...' : 'Clear chat'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 6b. Delete Group Confirmation Modal */}
      {showDeleteGroupConfirm && activeConversation && activeConversation.type === 'team' && (
        <div
          className="teams-modal-backdrop"
          onClick={() => !isDeletingGroup && setShowDeleteGroupConfirm(false)}
        >
          <div className="teams-confirm-modal-card" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: '#24213B' }}>
              Delete group &ldquo;{activeConversation.title}&rdquo;?
            </h3>
            <p style={{ margin: '10px 0 0', fontSize: '0.86rem', color: '#64748b', lineHeight: 1.5 }}>
              This will permanently delete the group, its message history, and shared files for all
              members on both the website and mobile app. This action cannot be undone.
            </p>
            <div className="teams-confirm-modal-actions">
              <button
                type="button"
                className="teams-confirm-cancel-btn"
                onClick={() => setShowDeleteGroupConfirm(false)}
                disabled={isDeletingGroup}
              >
                Cancel
              </button>
              <button
                type="button"
                className="teams-confirm-danger-btn"
                onClick={handleConfirmDeleteGroup}
                disabled={isDeletingGroup}
              >
                {isDeletingGroup ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                <span>{isDeletingGroup ? 'Deleting...' : 'Delete group'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 6c. WhatsApp-Style "Delete for Me" Confirmation Dialog */}
      {showDeleteForMeConfirm && activeConversation && (
        <div
          className="teams-modal-backdrop"
          onClick={() => !isDeletingForMe && setShowDeleteForMeConfirm(false)}
        >
          <div
            className="teams-delete-dialog-card"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-dialog-title"
          >
            <h3 id="delete-dialog-title" className="teams-delete-dialog-title">
              Delete conversation?
            </h3>
            <p className="teams-delete-dialog-message">
              Delete &ldquo;{activeConversation.title}&rdquo; from your inbox? This only deletes it for you.
            </p>
            <div className="teams-delete-dialog-actions">
              <button
                type="button"
                className="teams-delete-dialog-btn cancel"
                onClick={() => setShowDeleteForMeConfirm(false)}
                disabled={isDeletingForMe}
              >
                CANCEL
              </button>
              <button
                type="button"
                className="teams-delete-dialog-btn delete"
                onClick={handleConfirmDeleteForMe}
                disabled={isDeletingForMe}
              >
                {isDeletingForMe ? (
                  <>
                    <Loader2 size={13} className="animate-spin" />
                    <span>DELETING...</span>
                  </>
                ) : (
                  <span>DELETE</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 7. Toast Notification */}
      {toastNotification && (
        <div className={`teams-toast ${toastNotification.type}`} role="status">
          {toastNotification.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
          <span>{toastNotification.message}</span>
        </div>
      )}

      {/* 7. Fullscreen Image Lightbox Modal */}
      {lightboxImage && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.85)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: '24px',
          }}
          onClick={() => setLightboxImage(null)}
        >
          <button
            type="button"
            onClick={() => setLightboxImage(null)}
            style={{
              position: 'absolute',
              top: '20px',
              right: '20px',
              background: 'transparent',
              border: 'none',
              color: '#ffffff',
              cursor: 'pointer',
            }}
          >
            <X size={28} />
          </button>
          <img
            src={lightboxImage}
            alt="Preview"
            style={{ maxWidth: '90vw', maxHeight: '90vh', borderRadius: '8px', objectFit: 'contain' }}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
