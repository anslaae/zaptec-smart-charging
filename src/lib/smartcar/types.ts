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
