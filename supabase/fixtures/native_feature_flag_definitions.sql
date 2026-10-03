-- Primary-only definitions for a separately reviewed native pilot. Never apply on DR.
INSERT INTO public.resilience_feature_flags(id, code, default_enabled, description, updated_at)
VALUES
(gen_random_uuid(),'MOBILE_APP_ENABLED',false,'Native application',now()),
(gen_random_uuid(),'MOBILE_PLATFORM_ADMIN_ENABLED',false,'Native read-only administrator',now()),
(gen_random_uuid(),'MOBILE_PUSH_ENABLED',false,'Native push',now()),
(gen_random_uuid(),'MOBILE_OFFLINE_POS_ENABLED',false,'Native offline POS',now()),
(gen_random_uuid(),'MOBILE_DIRECT_PRINT_ENABLED',false,'Native direct print',now())
ON CONFLICT (code) DO NOTHING;
