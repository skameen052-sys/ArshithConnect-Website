import React from 'react';

export default function AdminStatCard({ label, value, colorClass = 'stat-val-present', widthClass = 'one-third', onClick, style, title }) {
  return (
    <div
      className={`stat-card ${widthClass}`}
      onClick={onClick}
      style={{ cursor: onClick ? 'pointer' : 'default', ...style }}
      title={title}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <span className="stat-card-label">{label}</span>
      <div className={`stat-card-value ${colorClass}`}>{value}</div>
    </div>
  );
}
