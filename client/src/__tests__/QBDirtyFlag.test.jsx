import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { QBDirtyProvider, useQBDirty } from '../context/QBDirtyContext';

// Minimal consumer that exposes context state for assertions
function DirtyConsumer() {
  const { isDirty, setIsDirty } = useQBDirty();
  return (
    <div>
      <span data-testid="dirty-state">{String(isDirty)}</span>
      <button onClick={() => setIsDirty(true)}>Make Dirty</button>
      <button onClick={() => setIsDirty(false)}>Clear Dirty</button>
    </div>
  );
}

describe('Unsaved changes — QBDirtyContext', () => {
  it('isDirty is false on initial render', () => {
    render(<QBDirtyProvider><DirtyConsumer /></QBDirtyProvider>);
    expect(screen.getByTestId('dirty-state').textContent).toBe('false');
  });

  it('setIsDirty(true) marks the quote as having unsaved changes', () => {
    render(<QBDirtyProvider><DirtyConsumer /></QBDirtyProvider>);
    fireEvent.click(screen.getByText('Make Dirty'));
    expect(screen.getByTestId('dirty-state').textContent).toBe('true');
  });

  it('setIsDirty(false) clears the dirty flag after save or discard', () => {
    render(<QBDirtyProvider><DirtyConsumer /></QBDirtyProvider>);
    fireEvent.click(screen.getByText('Make Dirty'));
    expect(screen.getByTestId('dirty-state').textContent).toBe('true');
    fireEvent.click(screen.getByText('Clear Dirty'));
    expect(screen.getByTestId('dirty-state').textContent).toBe('false');
  });

  it('dirty flag can be toggled multiple times', () => {
    render(<QBDirtyProvider><DirtyConsumer /></QBDirtyProvider>);
    fireEvent.click(screen.getByText('Make Dirty'));
    expect(screen.getByTestId('dirty-state').textContent).toBe('true');
    fireEvent.click(screen.getByText('Clear Dirty'));
    expect(screen.getByTestId('dirty-state').textContent).toBe('false');
    fireEvent.click(screen.getByText('Make Dirty'));
    expect(screen.getByTestId('dirty-state').textContent).toBe('true');
  });
});
