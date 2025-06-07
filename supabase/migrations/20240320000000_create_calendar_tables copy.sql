DROP POLICY IF EXISTS "Детали дня доступны всем аутентифицированным пользователям" ON public.day_details;
CREATE POLICY "Детали дня доступны всем (для разработки)"
ON public.day_details
FOR ALL -- или SELECT, INSERT, UPDATE, DELETE по отдельности
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "События доступны всем аутентифицированным пользователям" ON public.calendar_events;
CREATE POLICY "События CRUD доступны всем (для разработки)"
ON public.calendar_events
FOR ALL -- или нужные операции (SELECT, INSERT, UPDATE)
USING (true)
WITH CHECK (true);
