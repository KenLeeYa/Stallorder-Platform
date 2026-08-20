set lock_timeout = '5s';
set statement_timeout = '2min';

select cron.schedule(
  'stallorder-report-deliveries',
  '*/5 * * * *',
  'select app_private.invoke_due_report_deliveries()'
);
