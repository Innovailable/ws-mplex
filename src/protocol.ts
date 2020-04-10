export enum MsgType {
  Ack = 0,
  Nack = 1,
  Create = 2,
  Data = 3,
  Close = 4,
};

export interface AckMsg {
  // type
  t: MsgType.Ack;
  // tid
  i: number;
};

export interface NackMsg {
  // type
  t: MsgType.Nack;
  // tid
  i: number;
  // error msg
  e: string;
};

export interface CreateMsg {
  // type
  t: MsgType.Create;
  // tid
  i: number;
  // channel id
  c: number;
  // udata
  u: any;
};

export interface DataMsg {
  // type
  t: MsgType.Data;
  // tid
  i: number;
  // channel id
  c: number;
  // data
  d: Buffer | null;
};

export interface CloseMsg {
  // type
  t: MsgType.Close;
  // tid
  i: number;
  // channel id
  c: number;
  // cause/error
  e: string | null;
};

type DistributiveOmit<T, K extends keyof any> = T extends any
  ? Omit<T, K>
  : never;

export type Msg = AckMsg | NackMsg | CreateMsg | DataMsg | CloseMsg;
export type RawMsg = DistributiveOmit<Msg,"i">;

