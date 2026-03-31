import type { ReactNode } from 'react';

interface Column {
  key: string;
  label: string;
  width?: string;
}

interface TableProps {
  columns: Column[];
  children: ReactNode;
  className?: string;
}

export function Table({ columns, children, className }: TableProps) {
  return (
    <div className={`table-wrap ${className || ''}`}>
      <table className="data-table">
        <thead>
          <tr>
            {columns.map(c => (
              <th key={c.key} style={c.width ? { width: c.width } : undefined}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

interface TableRowProps {
  cells: ReactNode[];
  onClick?: () => void;
  className?: string;
}

export function TableRow({ cells, onClick, className }: TableRowProps) {
  return (
    <tr className={className} onClick={onClick} style={onClick ? { cursor: 'pointer' } : undefined}>
      {cells.map((cell, i) => <td key={i}>{cell}</td>)}
    </tr>
  );
}
