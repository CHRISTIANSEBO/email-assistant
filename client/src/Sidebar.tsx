import { useState } from 'react';
import type { TemplateItem, RecentChat } from './StaggeredMenu';
import './Sidebar.css';

export interface UserProfile {
  name: string;
  email: string;
  picture: string;
}

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  mobileOpen?: boolean;
  onFetchInbox: (category: string) => void;
  onCompose: () => void;
  templates: TemplateItem[];
  onUseTemplate: (t: TemplateItem) => void;
  onDeleteTemplate: (id: string) => void;
  recentChats: RecentChat[];
  onLoadChat: (id: string) => void;
  onDeleteChat: (id: string) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onNewChat: () => void;
  profile: UserProfile | null;
  onSignOut: () => void;
}

const NAV = [
  { id: 'primary',    label: 'Primary',     category: 'primary',    icon: <EmailIcon /> },
  { id: 'promotions', label: 'Promotions',  category: 'promotions', icon: <TagIcon /> },
  { id: 'social',     label: 'Social',      category: 'social',     icon: <PeopleIcon /> },
  { id: 'updates',    label: 'Updates',     category: 'updates',    icon: <BellIcon /> },
  { id: 'sort',       label: 'Priority',    category: 'sort',       icon: <StarIcon /> },
  { id: 'send',       label: 'Compose',     category: 'compose',    icon: <ComposeIcon /> },
  { id: 'unsub',      label: 'Unsubscribe', category: 'unsub',      icon: <BlockIcon /> },
];

export default function Sidebar({
  collapsed, onToggle: _onToggle, mobileOpen = false, onFetchInbox, onCompose, templates, onUseTemplate, onDeleteTemplate,
  recentChats, onLoadChat, onDeleteChat, searchQuery, onSearchChange, onNewChat,
  profile, onSignOut,
}: SidebarProps) {
  const [templatesOpen, setTemplatesOpen] = useState(true);
  const [recentsOpen, setRecentsOpen] = useState(true);

  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}${mobileOpen ? ' mobile-open' : ''}`}>

      {/* New chat */}
      <button type="button" className="sidebar-new-btn" onClick={onNewChat} title="New chat">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        {!collapsed && <span>New chat</span>}
      </button>

      {/* Search (expanded only) */}
      {!collapsed && (
        <div className="sidebar-search-wrap">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input
            type="search"
            className="sidebar-search"
            placeholder="Search chats..."
            value={searchQuery}
            onChange={e => onSearchChange(e.target.value)}
          />
        </div>
      )}

      {/* Nav */}
      <nav className="sidebar-nav">
        {NAV.map(item => (
          <button
            key={item.id}
            type="button"
            className="sidebar-nav-item"
            onClick={() => {
              if (item.category === 'compose') onCompose();
              else if (item.category === 'unsub') onFetchInbox('unsub');
              else onFetchInbox(item.category);
            }}
            title={collapsed ? item.label : undefined}
          >
            <span className="nav-icon">{item.icon}</span>
            {!collapsed && <span className="nav-label">{item.label}</span>}
          </button>
        ))}
      </nav>

      {/* Sections (expanded only) */}
      {!collapsed && (
        <>
          <div className="sidebar-divider" />

          {templates.length > 0 && (
            <div className="sidebar-section">
              <button type="button" className="sidebar-section-hdr" onClick={() => setTemplatesOpen(o => !o)}>
                Templates <Chevron open={templatesOpen} />
              </button>
              {templatesOpen && templates.map(t => (
                <div key={t.id} className="sidebar-row">
                  <button type="button" className="sidebar-row-btn" onClick={() => onUseTemplate(t)}>{t.name}</button>
                  <button type="button" className="sidebar-row-del" aria-label="Delete" onClick={() => onDeleteTemplate(t.id)}>×</button>
                </div>
              ))}
            </div>
          )}

          {recentChats.length > 0 && (
            <div className="sidebar-section">
              <button type="button" className="sidebar-section-hdr" onClick={() => setRecentsOpen(o => !o)}>
                {searchQuery ? 'Results' : 'Recent chats'} <Chevron open={recentsOpen} />
              </button>
              {recentsOpen && recentChats.slice(0, 12).map(c => (
                <div key={c.id} className="sidebar-row">
                  <button type="button" className="sidebar-row-btn" onClick={() => onLoadChat(c.id)}>{c.title}</button>
                  <button type="button" className="sidebar-row-del" aria-label="Delete" onClick={() => onDeleteChat(c.id)}>×</button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {/* Profile / sign-out */}
      {profile && (
        <>
          <div className="sidebar-divider" />
          <div className={`sidebar-profile${collapsed ? ' collapsed' : ''}`}>
            <div className="sidebar-avatar-wrap">
              {profile.picture ? (
                <img
                  src={profile.picture}
                  alt={profile.name}
                  className="sidebar-avatar-img"
                  referrerPolicy="no-referrer"
                  onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              ) : (
                <span className="sidebar-avatar-initials">
                  {profile.name ? profile.name[0].toUpperCase() : '?'}
                </span>
              )}
            </div>
            {!collapsed && (
              <div className="sidebar-profile-info">
                <span className="sidebar-profile-name">{profile.name || 'My account'}</span>
                <span className="sidebar-profile-email">{profile.email}</span>
              </div>
            )}
            {!collapsed && (
              <button type="button" className="sidebar-signout-btn" onClick={onSignOut} title="Sign out">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                  <polyline points="16 17 21 12 16 7"/>
                  <line x1="21" y1="12" x2="9" y2="12"/>
                </svg>
              </button>
            )}
          </div>
        </>
      )}
    </aside>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.2s' }}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function EmailIcon()   { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>; }
function TagIcon()     { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>; }
function PeopleIcon()  { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>; }
function BellIcon()    { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>; }
function StarIcon()    { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>; }
function ComposeIcon() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>; }
function BlockIcon()   { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>; }
