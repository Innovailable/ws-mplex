import { Duplex, DuplexOptions } from "stream";

import { ResponseCb } from "./types";
import { MultiplexShim } from "./multiplex_shim";

const SEND_TOLERANCE = 16 * 1024;

type ReceiveQueueEntry = [(Buffer | null), ResponseCb];

export interface MultiplexStreamOptions {
  highWaterMark?: number;
  writeMaxOutstanding?: number;
}

export class MultiplexStream extends Duplex {
  private shim: MultiplexShim;
  private reading = false;
  private receiveQueue = Array<ReceiveQueueEntry>();
  private openSendSize = 0;
  private writeMaxOutstanding: number;
  private sendCb?: ResponseCb;

  constructor(shim: MultiplexShim, options: MultiplexStreamOptions = {}) {
    super({
      highWaterMark: options.highWaterMark,
    });

    this.shim = shim;
    this.writeMaxOutstanding = options.writeMaxOutstanding ?? (64 * 1024);

    shim.receive = this.handleData.bind(this);
    shim.receive_close = this.handleClose.bind(this);
  }

  _write(chunk: Buffer, encoding: string, cb: ResponseCb) {
    const chunkSize = chunk.length;
    this.openSendSize += chunkSize;

    this.shim.write(chunk, () => {
      this.openSendSize -= chunkSize;

      if(this.sendCb != null && this.openSendSize <= this.writeMaxOutstanding) {
	this.sendCb();
	delete this.sendCb;
      }
    });

    // TODO never fails

    if(this.openSendSize > this.writeMaxOutstanding) {
      this.sendCb = cb;
    } else {
      cb();
    }
  }

  _destroy(reason: Error | null, callback: (err: Error | null) => void) {
    this.shim.send_close(reason, (err) => callback(err ?? null));

    this.doReceive();
  }

  _read() {
    this.reading = true;
    this.doReceive();
  }

  private doReceive() {
    if(this.destroyed) {
      const err = new Error("Stream is closed");

      while(this.receiveQueue.length > 0) {
        const [data, cb] = this.receiveQueue.shift()!;
        cb(err);
      }
    }

    if(!this.reading) {
      return;
    }

    while(this.receiveQueue.length > 0) {
      const [data, cb] = this.receiveQueue.shift()!;
      cb();

      if(!this.push(data)) {
	this.reading = false;
	return;
      }
    }
  }

  private handleData(data: Buffer | null, cb: ResponseCb) {
    this.receiveQueue.push([data, cb]);
    this.doReceive();
  }

  private handleClose(reason: Error | null, cb: ResponseCb) {
    this.destroy(reason ?? undefined);
    cb();
  }
}
