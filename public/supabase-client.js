import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://thattkovhgoatunkkrke.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRoYXR0a292aGdvYXR1bmtrcmtlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwNDEwOTAsImV4cCI6MjA5NzYxNzA5MH0.sJ29BlNgX2jV2NvoA5PJuRNKe_ar-YN0HDN9L8WHoXk';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export async function signInWithGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin }
  });
  if (error) console.error('Google sign-in error:', error);
}

export async function signInWithApple() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'apple',
    options: { redirectTo: window.location.origin }
  });
  if (error) console.error('Apple sign-in error:', error);
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function getCurrentUser() {
  const { data } = await supabase.auth.getUser();
  return data?.user || null;
}

export async function saveTrip(trip) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Must be signed in to save a trip');

  const { data, error } = await supabase
    .from('trips')
    .insert({
      user_id: user.id,
      title: trip.title,
      destination: trip.destination,
      origin: trip.origin,
      depart_date: trip.departDate || null,
      return_date: trip.returnDate || null,
      estimate: trip.estimate,
      summary: trip.summary,
      day_plan: trip.dayPlan || [],
      proposal_snapshot: trip.proposalSnapshot || null
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getMyTrips() {
  const { data, error } = await supabase
    .from('trips')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data;
}

export async function deleteTrip(tripId) {
  const { error } = await supabase.from('trips').delete().eq('id', tripId);
  if (error) throw error;
}
