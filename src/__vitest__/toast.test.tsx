import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it } from 'vitest';
import { ToastProvider, useToast } from '@/components/Toast';

function TestAdder() {
  const { addToast } = useToast();
  return <button onClick={() => addToast({ type: 'success', title: 'Saved!', message: 'It worked', duration: 0 })}>Add</button>;
}

describe('ToastProvider', () => {
  it('shows a toast when addToast is called', async () => {
    render(
      <ToastProvider>
        <TestAdder />
      </ToastProvider>
    );

    fireEvent.click(screen.getByText('Add'));

    expect(await screen.findByText('Saved!')).toBeDefined();
  });

  it('dismisses a toast when close button is clicked', async () => {
    render(
      <ToastProvider>
        <TestAdder />
      </ToastProvider>
    );

    fireEvent.click(screen.getByText('Add'));
    const title = await screen.findByText('Saved!');
    const container = title.closest('div');
    // dismiss button is the last button inside the toast item
    const buttons = container?.querySelectorAll('button');
    const dismiss = buttons ? buttons[buttons.length - 1] as HTMLElement : null;
    if (!dismiss) throw new Error('dismiss button not found');
    fireEvent.click(dismiss);
    // expect it to be removed
    expect(screen.queryByText('Saved!')).toBeNull();
  });
});
