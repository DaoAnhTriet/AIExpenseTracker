export interface Transaction {
  id: string; // unique timestamp or uuid
  date: string; // ISO-8601 string
  amount: number;
  category: string;
  note: string;
  type: 'expense' | 'income';
}

export interface UserProfile {
  total_balance: number;
  currency: string;
  monthly_budget: number;
}

export interface Goal {
  id: string;
  name: string;
  target: number;
  current: number;
}

export interface DriveData {
  user_profile: UserProfile;
  transactions: Transaction[];
  goals: Goal[];
}

export interface ParsedAISuggestion {
  amount: number;
  category: string;
  note: string;
  type: 'expense' | 'income';
  reply: string;
}
