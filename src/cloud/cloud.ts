// Accounts and cloud saves through Supabase (free tier). Turned on by two build-time settings,
// VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY; without them the app works fully offline in the
// browser. The database schema with its row-level security rules is in supabase/schema.sql.
import { createClient, type Session, type SupabaseClient, type User } from '@supabase/supabase-js';
import { create } from 'zustand';
import type { CadDocument } from '../model/types';

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const cloudEnabled = !!URL && !!KEY;

let client: SupabaseClient | null = null;
function sb(): SupabaseClient {
  if (!cloudEnabled) throw new Error('Cloud sync is not set up on this site');
  client ??= createClient(URL!, KEY!, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  return client;
}

interface CloudState {
  user: User | null;
  ready: boolean;
}

export const useCloud = create<CloudState>(() => ({ user: null, ready: !cloudEnabled }));

/** Starts listening for sign-in changes (also finishes OAuth and magic-link redirects). */
export function initCloud() {
  if (!cloudEnabled) return;
  const auth = sb().auth;
  void auth.getSession().then(({ data }) => useCloud.setState({ user: data.session?.user ?? null, ready: true }));
  auth.onAuthStateChange((_event, session: Session | null) => useCloud.setState({ user: session?.user ?? null, ready: true }));
}

const redirectTo = () => `${location.origin}${location.pathname}`;

export async function signInWith(provider: 'google' | 'github') {
  const { error } = await sb().auth.signInWithOAuth({ provider, options: { redirectTo: redirectTo() } });
  if (error) throw error;
}

/** Sends a one-time sign-in link; no password to remember. */
export async function signInWithEmail(email: string) {
  const { error } = await sb().auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo() } });
  if (error) throw error;
}

export async function signOut() {
  await sb().auth.signOut();
}

// ---------------------------------------------------------------- projects

export interface CloudMeta {
  id: string;
  name: string;
  thumb: string | null;
  features: number;
  created: number;
  modified: number;
  shared: boolean;
}

interface Row {
  id: string;
  name: string;
  thumb: string | null;
  feature_count: number;
  created_at: string;
  updated_at: string;
  shared: boolean;
  data?: CadDocument;
}

const toMeta = (r: Row): CloudMeta => ({
  id: r.id,
  name: r.name,
  thumb: r.thumb,
  features: r.feature_count,
  created: Date.parse(r.created_at),
  modified: Date.parse(r.updated_at),
  shared: r.shared,
});

const signedIn = () => !!useCloud.getState().user;

/** Saves (or updates) the document in the user's cloud projects. Does nothing when signed out. */
export async function saveToCloud(doc: CadDocument, thumb: string | null) {
  if (!cloudEnabled || !signedIn()) return;
  const row = {
    id: doc.id,
    owner: useCloud.getState().user!.id,
    name: doc.name,
    data: doc,
    feature_count: doc.features.length,
    updated_at: new Date(doc.modified).toISOString(),
    ...(thumb && { thumb }),
  };
  const { error } = await sb().from('projects').upsert(row);
  if (error) throw error;
}

export async function listCloud(): Promise<CloudMeta[]> {
  if (!cloudEnabled || !signedIn()) return [];
  const { data, error } = await sb()
    .from('projects')
    .select('id, name, thumb, feature_count, created_at, updated_at, shared')
    .eq('owner', useCloud.getState().user!.id)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data as Row[]).map(toMeta);
}

export async function loadFromCloud(id: string): Promise<CadDocument | null> {
  const { data, error } = await sb().from('projects').select('data').eq('id', id).maybeSingle();
  if (error) throw error;
  return (data as { data: CadDocument } | null)?.data ?? null;
}

export async function deleteFromCloud(id: string) {
  if (!cloudEnabled || !signedIn()) return;
  const { error } = await sb().from('projects').delete().eq('id', id);
  if (error) throw error;
}

/** Makes a project readable by anyone with the link and returns the link. */
export async function shareLink(doc: CadDocument, thumb: string | null): Promise<string> {
  await saveToCloud(doc, thumb);
  const { error } = await sb().from('projects').update({ shared: true }).eq('id', doc.id);
  if (error) throw error;
  return `${location.origin}/?share=${encodeURIComponent(doc.id)}`;
}

/** Reads a shared project (works signed out, through the "shared" row-level rule). */
export async function loadShared(id: string): Promise<CadDocument | null> {
  return loadFromCloud(id);
}
