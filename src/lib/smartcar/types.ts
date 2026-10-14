export interface SmartcarTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface SmartcarSignalApiResponse {
  data: {
    attributes: {
      status: { value: "SUCCESS" | "ERROR" };
      body?: { value: number; unit: string };
    };
    meta?: { oemUpdatedAt?: string; retrievedAt?: string };
  };
}

export interface StateOfCharge {
  percent: number;
  oemUpdatedAt: Date;
}

export interface Odometer {
  km: number;
  oemUpdatedAt: Date;
}

// Shapes Smartcar's webhook actually sends -- see
// https://smartcar.com/docs/integrations/webhooks/callback-verification and
// .../events/overview. Only the fields this app reads are modeled.
export interface SmartcarVerifyEvent {
  eventType: "VERIFY";
  data: { challenge: string };
}

export interface SmartcarWebhookSignal {
  code: string;
  body?: { value: unknown };
  status?: { value: "SUCCESS" | "ERROR" };
  meta?: { oemUpdatedAt?: string | number };
}

export interface SmartcarVehicleStateEvent {
  eventType: "VEHICLE_STATE";
  data: {
    vehicle?: { id?: string };
    signals?: SmartcarWebhookSignal[];
  };
}

export type SmartcarWebhookEvent =
  | SmartcarVerifyEvent
  | SmartcarVehicleStateEvent
  | { eventType: string; data?: unknown };
