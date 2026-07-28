import type { Sql } from "postgres";

export async function getAnalytics(sql: Sql, days: number) {
  // CURRENT_DATE - $1 with a bound integer parameter is ambiguous to Postgres
  // (date-integer vs date-date overload resolution can pick the wrong one,
  // erroring "operator does not exist: date >= integer") — pass a plain date
  // string instead, same pattern already used in learning/repository.ts.
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceDay = since.toISOString().slice(0, 10);

  const [
    studentsRows,
    active7Rows,
    active30Rows,
    revenueTotalRows,
    revenueMonthRows,
    revenueYearRows,
    avgStudyRows,
    completionRows,
    revenueSeries,
    studentsSeries,
    activitySeries,
    plans,
    methods,
  ] = await Promise.all([
    sql<{ students: number }[]>`SELECT count(*)::int AS students FROM public.profiles`,
    sql<{ active_7: number }[]>`SELECT count(DISTINCT user_id)::int AS active_7 FROM public.study_sessions WHERE day >= CURRENT_DATE - 7`,
    sql<{ active_30: number }[]>`SELECT count(DISTINCT user_id)::int AS active_30 FROM public.study_sessions WHERE day >= CURRENT_DATE - 30`,
    sql<{ revenue_total: number }[]>`SELECT COALESCE(SUM(amount_kz),0)::bigint AS revenue_total FROM public.payments WHERE status = 'paid'`,
    sql<{ revenue_month: number }[]>`SELECT COALESCE(SUM(amount_kz),0)::bigint AS revenue_month FROM public.payments WHERE status = 'paid' AND paid_at >= date_trunc('month', now())`,
    sql<{ revenue_year: number }[]>`SELECT COALESCE(SUM(amount_kz),0)::bigint AS revenue_year FROM public.payments WHERE status = 'paid' AND paid_at >= date_trunc('year', now())`,
    sql<{ avg_study_min: number }[]>`SELECT COALESCE(AVG(seconds),0)/60.0 AS avg_study_min FROM public.study_sessions WHERE day >= ${sinceDay}`,
    sql<{ completion_rate: number }[]>`
      SELECT CASE WHEN COUNT(*) = 0 THEN 0
                  ELSE (COUNT(*) FILTER (WHERE completed_at IS NOT NULL))::numeric * 100 / COUNT(*)
             END AS completion_rate
      FROM public.lesson_progress
    `,
    sql<{ month: string; amount: number }[]>`
      SELECT to_char(date_trunc('month', paid_at),'YYYY-MM') AS month, SUM(amount_kz)::bigint AS amount
      FROM public.payments
      WHERE status = 'paid' AND paid_at >= now() - interval '12 months'
      GROUP BY 1 ORDER BY 1
    `,
    sql<{ month: string; count: number }[]>`
      SELECT to_char(date_trunc('month', created_at),'YYYY-MM') AS month, count(*)::int AS count
      FROM public.profiles
      WHERE created_at >= now() - interval '12 months'
      GROUP BY 1 ORDER BY 1
    `,
    sql<{ day: string; seconds: number; users: number }[]>`
      SELECT to_char(day,'YYYY-MM-DD') AS day, SUM(seconds)::bigint AS seconds, count(DISTINCT user_id)::int AS users
      FROM public.study_sessions
      WHERE day >= ${sinceDay}
      GROUP BY day ORDER BY day
    `,
    sql<{ name: string; tier: string; orders: number; revenue: number }[]>`
      SELECT sp.name, sp.tier::text AS tier,
             count(p.id)::int AS orders,
             COALESCE(SUM(p.amount_kz) FILTER (WHERE p.status = 'paid'),0)::bigint AS revenue
      FROM public.subscription_plans sp
      LEFT JOIN public.payments p ON p.plan_id = sp.id
      GROUP BY sp.id, sp.name, sp.tier
      ORDER BY revenue DESC
    `,
    sql<{ method: string; count: number; revenue: number }[]>`
      SELECT COALESCE(method::text,'unknown') AS method,
             count(*)::int AS count,
             COALESCE(SUM(amount_kz) FILTER (WHERE status = 'paid'),0)::bigint AS revenue
      FROM public.payments
      GROUP BY method
    `,
  ]);

  const students = Number(studentsRows[0]?.students ?? 0);
  const active7 = Number(active7Rows[0]?.active_7 ?? 0);
  const active30 = Number(active30Rows[0]?.active_30 ?? 0);
  const completion = Number(completionRows[0]?.completion_rate ?? 0);
  const retention = students > 0 ? (active30 * 100) / students : 0;

  return {
    students,
    active_7: active7,
    active_30: active30,
    revenue_total: Number(revenueTotalRows[0]?.revenue_total ?? 0),
    revenue_month: Number(revenueMonthRows[0]?.revenue_month ?? 0),
    revenue_year: Number(revenueYearRows[0]?.revenue_year ?? 0),
    avg_study_min: Math.round(Number(avgStudyRows[0]?.avg_study_min ?? 0) * 10) / 10,
    completion_rate: Math.round(completion * 10) / 10,
    dropout_rate: Math.round(Math.max(0, 100 - completion) * 10) / 10,
    retention_rate: Math.round(retention * 10) / 10,
    revenue_series: revenueSeries,
    students_series: studentsSeries,
    activity_series: activitySeries,
    plans,
    methods,
  };
}

export async function getSecuritySummary(sql: Sql) {
  const [totalEventsRows, failedLoginsRows, activeLockoutsRows, criticalEventsRows, suspiciousIps, recentLockouts] =
    await Promise.all([
      sql<{ total_events_24h: number }[]>`SELECT count(*)::int AS total_events_24h FROM public.audit_logs WHERE created_at > now() - interval '24 hours'`,
      sql<{ failed_logins_24h: number }[]>`SELECT count(*)::int AS failed_logins_24h FROM public.login_attempts WHERE success = false AND created_at > now() - interval '24 hours'`,
      sql<{ active_lockouts: number }[]>`SELECT count(*)::int AS active_lockouts FROM public.account_lockouts WHERE locked_until > now()`,
      sql<{ critical_events_7d: number }[]>`SELECT count(*)::int AS critical_events_7d FROM public.audit_logs WHERE severity IN ('warning','critical') AND created_at > now() - interval '7 days'`,
      sql<{ ip_address: string; attempts: number }[]>`
        SELECT ip_address, count(*)::int AS attempts FROM public.login_attempts
        WHERE success = false AND created_at > now() - interval '24 hours' AND ip_address IS NOT NULL
        GROUP BY ip_address HAVING count(*) >= 3
        ORDER BY attempts DESC LIMIT 10
      `,
      sql`
        SELECT email, ip_address, locked_until, reason, created_at FROM public.account_lockouts
        WHERE created_at > now() - interval '7 days'
        ORDER BY created_at DESC LIMIT 20
      `,
    ]);

  return {
    total_events_24h: Number(totalEventsRows[0]?.total_events_24h ?? 0),
    failed_logins_24h: Number(failedLoginsRows[0]?.failed_logins_24h ?? 0),
    active_lockouts: Number(activeLockoutsRows[0]?.active_lockouts ?? 0),
    critical_events_7d: Number(criticalEventsRows[0]?.critical_events_7d ?? 0),
    suspicious_ips: suspiciousIps,
    recent_lockouts: recentLockouts,
  };
}

export async function listAuditLogs(sql: Sql, limit: number, severity?: string, action?: string) {
  return sql`
    SELECT * FROM public.audit_logs
    WHERE (${severity ?? null}::text IS NULL OR severity = ${severity ?? null})
      AND (${action ?? null}::text IS NULL OR action ILIKE ${"%" + (action ?? "") + "%"})
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
}

export async function listLoginAttempts(sql: Sql, limit: number) {
  return sql`SELECT * FROM public.login_attempts ORDER BY created_at DESC LIMIT ${limit}`;
}

export async function listLockouts(sql: Sql, limit: number) {
  return sql`SELECT * FROM public.account_lockouts ORDER BY created_at DESC LIMIT ${limit}`;
}

export async function reportUsers(sql: Sql, limit: number) {
  return sql`
    SELECT p.full_name, u.email, p.phone, p.country, p.age, p.cefr_level, p.onboarding_status, u.created_at
    FROM public.app_users u
    LEFT JOIN public.profiles p ON p.id = u.id
    ORDER BY u.created_at DESC
    LIMIT ${limit}
  `;
}

export async function reportPayments(sql: Sql, limit: number) {
  return sql`
    SELECT user_id, amount_kz, status, reference, paid_at, created_at
    FROM public.payments
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
}

export async function reportDiagnostics(sql: Sql, limit: number) {
  return sql`
    SELECT user_id, cefr_level, grammar_score, vocabulary_score, reading_score, listening_score,
           writing_score, speaking_score, pronunciation_score, created_at
    FROM public.diagnostic_results
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
}
