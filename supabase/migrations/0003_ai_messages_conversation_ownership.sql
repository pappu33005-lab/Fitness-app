-- Conversation ownership for ai_messages.
-- A message row may only be read/written when its conversation also belongs to the same auth user.
-- Safe to apply after 0001/0002 on fresh or existing projects.

drop policy if exists ai_messages_own on public.ai_messages;

create policy ai_messages_own on public.ai_messages
  for all
  using (
    user_id = auth.uid()
    and exists (
      select 1
      from public.ai_conversations c
      where c.id = ai_messages.conversation_id
        and c.user_id = auth.uid()
    )
  )
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.ai_conversations c
      where c.id = ai_messages.conversation_id
        and c.user_id = auth.uid()
    )
  );
