import { Duplex, DuplexOptions } from "stream";

import { ResponseCb } from "./types";
import { MultiplexShim } from "./multiplex_shim";

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
  private sendCb?: ResponseCb = undefined;

  constructor(shim: MultiplexShim, options: MultiplexStreamOptions = {}) {
    super({
      highWaterMark: options.highWaterMark,
    });

    this.shim = shim;
    this.writeMaxOutstanding = options.writeMaxOutstanding ?? (64 * 1024);

    shim.receive = this.handleData.bind(this);
    shim.receive_close = this.handleClose.bind(this);
  }

  _final(cb: ResponseCb) {
    this.shim.write(null, cb);
  }

  _write(chunk: Buffer, encoding: string, cb: ResponseCb) {
    const chunkSize = chunk.length;
    this.openSendSize += chunkSize;

    this.shim.write(chunk, () => {
      this.openSendSize -= chunkSize;

      if(this.sendCb != null && this.openSendSize <= this.writeMaxOutstanding) {
        const { sendCb } = this;
        this.sendCb = undefined;
        sendCb();
      }
    });

    // TODO never fails

    if(this.openSendSize > this.writeMaxOutstanding) {
      if(this.sendCb != null) {
        throw new Error("Trying to set send callback with callback already set");
      }

      this.sendCb = cb;
    } else {
      cb();
    }
  }

  _destroy(reason: Error | null, callback: (err: Error | null) => void) {
    this.shim.send_close(reason, (err) => {
      callback(err ?? null);
      this.shim.release();
    });

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
