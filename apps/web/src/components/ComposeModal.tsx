import { useState, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { campaignApi, senderApi } from '../services/api';
import {
  X, Upload, AlertCircle, CheckCircle, Info,
  Users, Clock, Zap, Mail
} from 'lucide-react';
import Papa from 'papaparse';
import toast from 'react-hot-toast';

const composeSchema = z.object({
  name: z.string().min(1, 'Campaign name is required'),
  senderId: z.string().min(1, 'Please select a sender'),
  subject: z.string().min(1, 'Subject is required').max(998),
  body: z.string().min(1, 'Message body is required'),
  startAt: z.string().min(1, 'Start time is required'),
  delaySeconds: z.coerce.number().int().min(0).max(3600),
  maxEmailsPerHour: z.coerce.number().int().min(1).max(1000),
});

type ComposeForm = z.infer<typeof composeSchema>;

interface ParseResult {
  valid: string[];
  invalid: string[];
  duplicates: number;
}

export default function ComposeModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [manualRecipients, setManualRecipients] = useState('');
  const [dragOver, setDragOver] = useState(false);

  const { data: senders } = useQuery({
    queryKey: ['senders'],
    queryFn: senderApi.list,
  });

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ComposeForm>({
    resolver: zodResolver(composeSchema),
    defaultValues: {
      delaySeconds: 2,
      maxEmailsPerHour: 100,
      startAt: new Date(Date.now() + 60 * 1000).toISOString().slice(0, 16),
    },
  });

  const scheduleMutation = useMutation({
    mutationFn: campaignApi.create,
    onSuccess: (data) => {
      toast.success(`Campaign scheduled: ${data.totalRecipients} recipients queued`);
      queryClient.invalidateQueries({ queryKey: ['emails-scheduled'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      onClose();
    },
    onError: (err: Error) => {
      toast.error(err.message ?? 'Failed to schedule campaign');
    },
  });

  const parseRecipients = useCallback((content: string) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const seen = new Set<string>();
    const valid: string[] = [];
    const invalid: string[] = [];
    let duplicates = 0;

    // Try CSV parse first
    const result = Papa.parse<string[]>(content, { skipEmptyLines: true });

    for (const row of result.data) {
      for (const cell of row) {
        const normalized = cell.trim().toLowerCase();
        if (!normalized) continue;
        if (!emailRegex.test(normalized)) {
          invalid.push(normalized);
        } else if (seen.has(normalized)) {
          duplicates++;
        } else {
          seen.add(normalized);
          valid.push(normalized);
        }
      }
    }

    setParseResult({ valid, invalid, duplicates });
  }, []);

  const handleFileUpload = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      parseRecipients(content);
    };
    reader.readAsText(file);
  }, [parseRecipients]);

  const onSubmit = (data: ComposeForm) => {
    const recipients = parseResult?.valid ?? manualRecipients.split(/[\n,;]/).map((r) => r.trim()).filter(Boolean);
    if (!recipients.length) {
      toast.error('Please add at least one valid recipient');
      return;
    }

    const formData = new FormData();
    Object.entries(data).forEach(([k, v]) => formData.append(k, String(v)));
    recipients.forEach((r) => formData.append('recipients', r));

    scheduleMutation.mutate(formData);
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-800">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-primary-600/20 rounded-lg">
              <Mail className="w-4 h-4 text-primary-400" />
            </div>
            <h2 className="text-lg font-semibold text-white">Schedule Campaign</h2>
          </div>
          <button onClick={onClose} className="btn-ghost p-1.5" id="close-compose-btn">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-5">
          {/* Campaign name */}
          <div>
            <label className="label">Campaign Name</label>
            <input {...register('name')} className={`input ${errors.name ? 'input-error' : ''}`} placeholder="e.g., November Outreach" />
            {errors.name && <p className="text-xs text-red-400 mt-1">{errors.name.message}</p>}
          </div>

          {/* Sender */}
          <div>
            <label className="label">Sender</label>
            {!senders?.length ? (
              <div className="flex items-start gap-2 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                <AlertCircle className="w-4 h-4 text-yellow-400 mt-0.5 shrink-0" />
                <div className="text-xs text-yellow-300">
                  No senders configured. Run <code className="bg-yellow-900/30 px-1 rounded">npm run create-ethereal --workspace=apps/api</code> to create a test sender.
                </div>
              </div>
            ) : (
              <select {...register('senderId')} className={`input ${errors.senderId ? 'input-error' : ''}`} id="sender-select">
                <option value="">Select a sender…</option>
                {senders.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} &lt;{s.email}&gt;</option>
                ))}
              </select>
            )}
            {errors.senderId && <p className="text-xs text-red-400 mt-1">{errors.senderId.message}</p>}
          </div>

          {/* Subject */}
          <div>
            <label className="label">Subject</label>
            <input {...register('subject')} className={`input ${errors.subject ? 'input-error' : ''}`} placeholder="Product demonstration" />
            {errors.subject && <p className="text-xs text-red-400 mt-1">{errors.subject.message}</p>}
          </div>

          {/* Body */}
          <div>
            <label className="label">Message Body</label>
            <textarea
              {...register('body')}
              rows={5}
              className={`input resize-y ${errors.body ? 'input-error' : ''}`}
              placeholder="Hello, I'd like to introduce..."
            />
            {errors.body && <p className="text-xs text-red-400 mt-1">{errors.body.message}</p>}
          </div>

          {/* Recipients */}
          <div>
            <label className="label">Recipients</label>

            {/* Upload zone */}
            <div
              className={`border-2 border-dashed rounded-xl p-6 text-center transition-colors cursor-pointer ${
                dragOver ? 'border-primary-500 bg-primary-500/5' : 'border-surface-700 hover:border-surface-600'
              }`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const file = e.dataTransfer.files[0];
                if (file) handleFileUpload(file);
              }}
              onClick={() => document.getElementById('recipient-file-input')?.click()}
            >
              <input
                id="recipient-file-input"
                type="file"
                accept=".csv,.txt"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileUpload(file);
                }}
              />
              <Upload className="w-6 h-6 text-slate-500 mx-auto mb-2" />
              <p className="text-sm text-slate-400">Drop a CSV or TXT file here, or click to browse</p>
              <p className="text-xs text-slate-600 mt-1">One email per line or comma-separated</p>
            </div>

            {/* Manual entry */}
            <div className="mt-3">
              <label className="label text-xs text-slate-500">Or paste addresses manually</label>
              <textarea
                value={manualRecipients}
                onChange={(e) => {
                  setManualRecipients(e.target.value);
                  if (e.target.value) parseRecipients(e.target.value);
                }}
                className="input text-xs"
                rows={3}
                placeholder="alice@example.com, bob@example.com..."
              />
            </div>

            {/* Parse results */}
            {parseResult && (
              <div className="mt-3 space-y-2">
                <div className="flex items-center gap-2 text-xs text-emerald-400">
                  <CheckCircle className="w-3.5 h-3.5" />
                  <span className="font-medium">{parseResult.valid.length} valid recipients</span>
                  {parseResult.duplicates > 0 && (
                    <span className="text-slate-500">({parseResult.duplicates} duplicates removed)</span>
                  )}
                </div>
                {parseResult.invalid.length > 0 && (
                  <div className="flex items-start gap-2 text-xs text-red-400">
                    <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>{parseResult.invalid.length} invalid addresses skipped</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Scheduling config */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="label">
                <Clock className="w-3.5 h-3.5 inline mr-1 text-slate-500" />
                Start Date & Time
              </label>
              <input
                {...register('startAt')}
                type="datetime-local"
                className={`input ${errors.startAt ? 'input-error' : ''}`}
              />
              {errors.startAt && <p className="text-xs text-red-400 mt-1">{errors.startAt.message}</p>}
            </div>

            <div>
              <label className="label">
                <Zap className="w-3.5 h-3.5 inline mr-1 text-slate-500" />
                Delay (seconds)
              </label>
              <input
                {...register('delaySeconds')}
                type="number"
                min={0}
                max={3600}
                className={`input ${errors.delaySeconds ? 'input-error' : ''}`}
              />
              {errors.delaySeconds && <p className="text-xs text-red-400 mt-1">{errors.delaySeconds.message}</p>}
            </div>

            <div>
              <label className="label">
                <Users className="w-3.5 h-3.5 inline mr-1 text-slate-500" />
                Max/Hour
              </label>
              <input
                {...register('maxEmailsPerHour')}
                type="number"
                min={1}
                max={1000}
                className={`input ${errors.maxEmailsPerHour ? 'input-error' : ''}`}
              />
              {errors.maxEmailsPerHour && <p className="text-xs text-red-400 mt-1">{errors.maxEmailsPerHour.message}</p>}
            </div>
          </div>

          {/* Info banner */}
          <div className="flex items-start gap-2 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
            <Info className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
            <p className="text-xs text-blue-300">
              Rate limits may push emails beyond the requested start time. Excess emails are
              automatically rescheduled to the next hour window, not dropped.
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button
              type="submit"
              className="btn-primary"
              disabled={scheduleMutation.isPending || !senders?.length}
              id="schedule-submit-btn"
            >
              {scheduleMutation.isPending ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Scheduling…
                </>
              ) : (
                <>
                  <Mail className="w-4 h-4" />
                  Schedule Campaign
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
