import React from 'react';
import TeamsChatWorkspace from '../../components/chat/TeamsChatWorkspace';

/**
 * AdminChat - Microsoft Teams Real-Time Collaboration Workspace for Administrators
 * Allows administrators to chat with any individual employee or post/manage all team channels.
 */
export default function AdminChat() {
  return (
    <div
      className="admin-chat-page animate-fade-in"
      style={{
        padding: '0 4px 4px 4px',
        height: 'calc(100dvh - 108px)',
        minHeight: '460px',
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <TeamsChatWorkspace />
    </div>
  );
}
