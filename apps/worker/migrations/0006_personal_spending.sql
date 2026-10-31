CREATE TABLE personal_spending (
  group_id TEXT NOT NULL,
  expense_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  description TEXT NOT NULL,
  expense_date TEXT NOT NULL,
  category TEXT NOT NULL,
  currency TEXT NOT NULL,
  amount INTEGER NOT NULL,
  rev INTEGER NOT NULL,
  PRIMARY KEY (group_id, expense_id, user_id)
);
--> statement-breakpoint
CREATE INDEX personal_spending_user_date ON personal_spending (user_id, expense_date, category);
