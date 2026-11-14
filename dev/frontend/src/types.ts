export interface User {
  id: number;
  login: string;
  name: string;
}

export interface RouteInfo {
  code: string;
  name: string;
  origin: string;
  destination: string;
  base_price: number;
  price_min: number;
  price_max: number;
  price_sensitivity: number;
  cost_per_passenger: number;
}

export interface Meta {
  routes: RouteInfo[];
  date_min: string;
  date_max: string;
  forecast_source: string;
}

export interface Scenario {
  quantile: number;
  base_demand: number;
  wanted: number;
  sold: number;
  best_price: number | null;
}

export interface SelloutProbability {
  p: number;
  bound: "gt" | "lt" | "eq";
}

export interface ForecastResult {
  route: RouteInfo;
  date: string;
  price: number;
  seats: number;
  base_demand_median: number;
  wanted: number;
  sold: number;
  free_seats: number;
  load_factor: number;
  revenue: number;
  profit: number;
  recommended_price: number | null;
  sellout_probability: SelloutProbability;
  scenarios: Scenario[];
}

export interface HistoryItem {
  route: string;
  name: string;
  flight_date: string;
  price: number;
  seats: number;
  sold: number;
  created_at: string;
}

export interface ForecastRequest {
  origin: string;
  destination: string;
  date: string;
  price: number;
}
