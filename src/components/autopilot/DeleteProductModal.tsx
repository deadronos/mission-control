'use client';

import { useState } from 'react';
import { AlertTriangle, Loader } from 'lucide-react';

interface DeleteProductModalProps {
  product: { id: string; name: string };
  onClose: () => void;
  onArchive: (id: string) => void;
  onDeleted: (id: string) => void;
}

export function DeleteProductModal({ product, onClose, onArchive, onDeleted }: DeleteProductModalProps) {
  const [step, setStep] = useState<'initial' | 'delete_confirm'>('initial');
  const [deleteInput, setDeleteInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function readErrorMessage(res: Response, fallback: string): Promise<string> {
    try {
      const data = await res.json() as { error?: string; message?: string };
      return data.error || data.message || fallback;
    } catch {
      return fallback;
    }
  }

  async function handleArchive() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/products/${product.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await readErrorMessage(res, 'Archive failed'));
      onArchive(product.id);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleHardDelete() {
    if (deleteInput !== 'DELETE') return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/products/${product.id}?hard=true`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await readErrorMessage(res, 'Delete failed'));
      onDeleted(product.id);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-mc-bg-secondary border border-mc-border rounded-xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-mc-border">
          <div className="p-2 bg-red-500/10 rounded-full">
            <AlertTriangle className="w-5 h-5 text-red-400" />
          </div>
          <div>
            <h3 className="font-semibold text-mc-text">
              {step === 'initial' ? 'Delete Product' : 'Confirm Permanent Delete'}
            </h3>
            <p className="text-xs text-mc-text-secondary">
              {step === 'initial' ? 'Choose an action' : 'This cannot be undone'}
            </p>
          </div>
        </div>

        {/* Body */}
        <div className="px-5 py-4">
          {error && (
            <div className="mb-3 text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded px-3 py-2">
              {error}
            </div>
          )}

          {step === 'initial' ? (
            <p className="text-sm text-mc-text-secondary">
              Are you sure you want to delete <strong className="text-mc-text">{product.name}</strong>?
            </p>
          ) : (
            <div>
              <p className="text-sm text-red-400 mb-3">
                This will permanently delete <strong>{product.name}</strong> and all its ideas, research cycles, and swipe history. This action cannot be undone.
              </p>
              <input
                type="text"
                value={deleteInput}
                onChange={e => setDeleteInput(e.target.value)}
                placeholder="Type DELETE to confirm"
                className="w-full bg-mc-bg border border-red-500/30 rounded-lg px-3 py-2 text-sm text-mc-text placeholder:text-mc-text-secondary/50 focus:outline-none focus:border-red-500"
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-mc-border bg-mc-bg">
          <button
            onClick={step === 'initial' ? onClose : () => { setStep('initial'); setDeleteInput(''); }}
            className="px-4 py-2 text-sm text-mc-text-secondary hover:text-mc-text"
            disabled={loading}
          >
            Cancel
          </button>
          {step === 'initial' ? (
            <>
              <button
                onClick={handleArchive}
                disabled={loading}
                className="px-4 py-2 text-sm rounded-lg bg-mc-bg border border-mc-border text-mc-text hover:bg-mc-bg-tertiary disabled:opacity-50"
              >
                {loading ? <Loader className="w-4 h-4 animate-spin" /> : 'Archive'}
              </button>
              <button
                onClick={() => setStep('delete_confirm')}
                className="px-4 py-2 text-sm rounded-lg bg-red-500/20 border border-red-500/30 text-red-400 hover:bg-red-500/30"
              >
                Delete
              </button>
            </>
          ) : (
            <button
              onClick={handleHardDelete}
              disabled={deleteInput !== 'DELETE' || loading}
              className="px-4 py-2 text-sm rounded-lg bg-red-500 text-white hover:bg-red-400 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? <Loader className="w-4 h-4 animate-spin" /> : 'Permanently Delete'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}