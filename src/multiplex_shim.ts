import { EventEmitter } from "events";

import { ResponseCb } from "./types";

type DataHandler = (data: Buffer | null, cb: ResponseCb) => void;
type CloseHandler = (reason: Error | null, cb: ResponseCb) => void;

export interface MultiplexShim {
  write: DataHandler;
  send_close: CloseHandler;

  receive?: DataHandler;
  receive_close?: CloseHandler;
}
