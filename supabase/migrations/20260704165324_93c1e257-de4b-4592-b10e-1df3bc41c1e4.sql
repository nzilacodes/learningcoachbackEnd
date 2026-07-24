
-- ============ ROLES ============
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE POLICY "users read own roles" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- ============ PROFILES ============
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  email TEXT,
  phone TEXT,
  country TEXT,
  age INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own profile select" ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "own profile insert" ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());
CREATE POLICY "own profile update" ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- ============ SUBSCRIPTION PLANS ============
CREATE TYPE public.plan_tier AS ENUM ('essential', 'premium', 'vip');
CREATE TYPE public.billing_cycle AS ENUM ('monthly', 'quarterly', 'semiannual');

CREATE TABLE public.subscription_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tier public.plan_tier NOT NULL,
  billing_cycle public.billing_cycle NOT NULL,
  price_kz INTEGER NOT NULL,
  duration_days INTEGER NOT NULL,
  call_minutes INTEGER NOT NULL DEFAULT 0,
  community_access BOOLEAN NOT NULL DEFAULT false,
  features JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tier, billing_cycle)
);
GRANT SELECT ON public.subscription_plans TO authenticated, anon;
GRANT ALL ON public.subscription_plans TO service_role;
ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "plans readable by all" ON public.subscription_plans FOR SELECT TO anon, authenticated USING (is_active = true);
CREATE POLICY "plans admin manage" ON public.subscription_plans FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============ SUBSCRIPTIONS ============
CREATE TYPE public.subscription_status AS ENUM ('pending', 'active', 'expired', 'cancelled');

CREATE TABLE public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES public.subscription_plans(id),
  status public.subscription_status NOT NULL DEFAULT 'pending',
  starts_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.subscriptions TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own sub select" ON public.subscriptions FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "own sub insert" ON public.subscriptions FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "admin sub update" ON public.subscriptions FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_sub_user ON public.subscriptions(user_id);
CREATE INDEX idx_sub_status ON public.subscriptions(status);

-- ============ PAYMENTS ============
CREATE TYPE public.payment_status AS ENUM ('pending', 'paid', 'cancelled', 'expired');

CREATE TABLE public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES public.subscriptions(id) ON DELETE SET NULL,
  plan_id UUID NOT NULL REFERENCES public.subscription_plans(id),
  amount_kz INTEGER NOT NULL,
  reference TEXT NOT NULL UNIQUE,
  entity TEXT NOT NULL DEFAULT '11473',
  status public.payment_status NOT NULL DEFAULT 'pending',
  paid_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '72 hours'),
  activated_by UUID REFERENCES auth.users(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.payments TO authenticated;
GRANT ALL ON public.payments TO service_role;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own pay select" ON public.payments FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "own pay insert" ON public.payments FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "admin pay update" ON public.payments FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_pay_user ON public.payments(user_id);
CREATE INDEX idx_pay_status ON public.payments(status);

-- ============ TRIGGERS ============
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_subs_updated BEFORE UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_pay_updated BEFORE UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Auto-create profile + default role on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, phone, country, age)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''),
    NEW.email,
    NEW.raw_user_meta_data->>'phone',
    NEW.raw_user_meta_data->>'country',
    NULLIF(NEW.raw_user_meta_data->>'age','')::INT
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user')
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Auto-expire subscriptions helper (called by admin/UI)
CREATE OR REPLACE FUNCTION public.expire_subscriptions()
RETURNS void LANGUAGE SQL SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.subscriptions SET status = 'expired'
  WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at < now();
$$;

-- ============ SEED 9 PLANS ============
INSERT INTO public.subscription_plans (tier, billing_cycle, price_kz, duration_days, call_minutes, community_access, features) VALUES
('essential','monthly',10000,30,0,false,'["Acesso Premium à plataforma","Todas as lições CEFR A1-C2","AI Coach 24/7"]'::jsonb),
('essential','quarterly',25000,90,0,false,'["Acesso Premium à plataforma","Todas as lições CEFR A1-C2","AI Coach 24/7","Economize 5.000 Kz"]'::jsonb),
('essential','semiannual',40000,180,0,false,'["Acesso Premium à plataforma","Todas as lições CEFR A1-C2","AI Coach 24/7","Economize 20.000 Kz"]'::jsonb),
('premium','monthly',15000,30,30,true,'["Tudo do Essencial","30 min chamada/videochamada com o professor","Acesso à Sala de Conversa"]'::jsonb),
('premium','quarterly',35000,90,30,true,'["Tudo do Essencial","30 min chamada/mês com o professor","Sala de Conversa","Economize 10.000 Kz"]'::jsonb),
('premium','semiannual',60000,180,30,true,'["Tudo do Essencial","30 min chamada/mês com o professor","Sala de Conversa","Economize 30.000 Kz"]'::jsonb),
('vip','monthly',25000,30,60,true,'["Tudo do Premium","60 min chamada/videochamada com o professor","Prioridade no suporte","Certificados destacados"]'::jsonb),
('vip','quarterly',60000,90,60,true,'["Tudo do Premium","60 min chamada/mês com o professor","Prioridade no suporte","Economize 15.000 Kz"]'::jsonb),
('vip','semiannual',100000,180,60,true,'["Tudo do Premium","60 min chamada/mês com o professor","Prioridade no suporte","Economize 50.000 Kz"]'::jsonb);
