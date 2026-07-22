/**
 * v2 primitive tests — pagination parity with ui/TablePagination semantics,
 * SegmentTabs hidden-item gating (role-gated tabs must not render), StatusPill
 * tones. Rendered with the real i18n engine (imported for side effects).
 */
import React, { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '../../i18n';
import { usePagination } from '../ui/usePagination';
import { TablePaginationV2 } from './TablePaginationV2';
import { SegmentTabs } from './SegmentTabs';
import { StatusPill } from './StatusPill';
import { StatCard } from './StatCard';

const ROWS = Array.from({ length: 62 }, (_, i) => i + 1);

function Harness({ alwaysShow = false, rows = ROWS }: { alwaysShow?: boolean; rows?: number[] }) {
  const { pageRows, controls } = usePagination(rows);
  return (
    <div>
      <div data-testid="page-rows">{pageRows.join(',')}</div>
      <TablePaginationV2 controls={controls} alwaysShow={alwaysShow} label="assets" />
    </div>
  );
}

describe('TablePaginationV2', () => {
  it('shows range text, numbered pages, and navigates like ui/TablePagination', () => {
    render(<Harness />);
    expect(screen.getByText('Showing 1 to 10 of 62 assets')).toBeInTheDocument();
    // 62 rows / 10 per page = 7 pages → all numbered, no gaps
    expect(screen.getByRole('button', { name: '7' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1' })).toHaveAttribute('aria-current', 'page');

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByText('Showing 11 to 20 of 62 assets')).toBeInTheDocument();
    expect(screen.getByTestId('page-rows').textContent).toBe('11,12,13,14,15,16,17,18,19,20');

    fireEvent.click(screen.getByRole('button', { name: '7' }));
    expect(screen.getByText('Showing 61 to 62 of 62 assets')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
  });

  it('hides entirely for an empty list unless alwaysShow', () => {
    const { container } = render(<Harness rows={[]} />);
    expect(container.querySelector('button')).toBeNull();
    render(<Harness rows={[]} alwaysShow />);
    expect(screen.getByText('No rows')).toBeInTheDocument();
  });

  it('changes page size via the "/ page" select', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('assets per page'), { target: { value: '25' } });
    expect(screen.getByText('Showing 1 to 25 of 62 assets')).toBeInTheDocument();
  });
});

function Tabs({ hideB = false }: { hideB?: boolean }) {
  const [tab, setTab] = useState('a');
  return (
    <div>
      <SegmentTabs
        items={[
          { key: 'a', label: 'Alpha' },
          { key: 'b', label: 'Beta', hidden: hideB },
          { key: 'c', label: 'Gamma', count: 4 },
        ]}
        value={tab}
        onChange={setTab}
      />
      <div data-testid="active">{tab}</div>
    </div>
  );
}

describe('SegmentTabs', () => {
  it('switches tabs on click and marks the active one', () => {
    render(<Tabs />);
    expect(screen.getByRole('tab', { name: 'Alpha' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('tab', { name: /Gamma/ }));
    expect(screen.getByTestId('active').textContent).toBe('c');
    expect(screen.getByRole('tab', { name: /Gamma/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('does not render hidden (role-gated) tabs at all', () => {
    render(<Tabs hideB />);
    expect(screen.queryByRole('tab', { name: 'Beta' })).toBeNull();
    expect(screen.getAllByRole('tab')).toHaveLength(2);
  });

  it('renders count badges', () => {
    render(<Tabs />);
    expect(screen.getByText('4')).toBeInTheDocument();
  });
});

describe('StatusPill / StatCard', () => {
  it('applies tone classes', () => {
    render(<StatusPill tone="green" label="Generated" />);
    expect(screen.getByText('Generated').className).toContain('text-green-700');
  });

  it('StatCard colors value independently of icon tone', () => {
    render(<StatCard label="Overdue" value="510" tone="red" valueTone="red" caption="Needs attention" />);
    expect(screen.getByText('510').className).toContain('text-red-600');
    expect(screen.getByText('Needs attention')).toBeInTheDocument();
  });

  it('StatCard renders the View link only when onView is given', () => {
    const { rerender } = render(<StatCard label="On Duty" value="08" />);
    expect(screen.queryByText(/→/)).toBeNull();
    rerender(<StatCard label="On Duty" value="08" onView={() => {}} viewLabel="View list" />);
    expect(screen.getByText(/View list/)).toBeInTheDocument();
  });
});
