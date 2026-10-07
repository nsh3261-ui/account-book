alter table public.expenses
  add column if not exists category text not null default '기타';

alter table public.expenses
  drop constraint if exists expenses_category_check;

alter table public.expenses
  add constraint expenses_category_check
  check (category in ('식비', '교통', '쇼핑', '문화', '기타'));

update public.expenses
set category = '기타'
where category is null or category = '';
