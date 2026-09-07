export type ManualPosition = {
  id: string;
  symbol: string;
  side: "LONG" | "SHORT";
  entry: number;
  size: number;
  leverage: number;
};

export type AppAlert = {
  id: string;
  time: string;
  symbol: string;
  display: string;
  type: "ENTRY" | "REVERSAL" | "EXIT";
  score: number;
  intensity: "INFO" | "WATCH" | "WARNING" | "HIGH" | "CRITICAL";
  title: string;
  reasons: string[];
};
