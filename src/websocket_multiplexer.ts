import { EventEmitter } from 'events';
import { Duplex } from 'stream';
import * as Websocket from 'ws';
import { encode, decode } from "@msgpack/msgpack"

import { Msg, RawMsg, MsgType } from './protocol';

import { ResponseCb } from "./types";
import { MultiplexShim } from "./multiplex_shim";
import { MultiplexStream, MultiplexStreamOptions } from "./multiplex_stream";

type OnCreateCb = ((err: Error) => void) | (() => Duplex);
type OnCreateEvent = (userData: any, cb: OnCreateCb) => void;

type CreateCb = (err: Error | null, stream?: Duplex) => void;

interface WebSocketMultiplexerOptions extends MultiplexStreamOptions {
  even: boolean;
};

class WebsocketMultiplexer extends EventEmitter {
  oncreate?: OnCreateEvent;

  private websocket: Websocket;
  private options: WebSocketMultiplexerOptions;

  private shims = new Map<number,MultiplexShim|false>();
  private outstanding = new Map<number,ResponseCb>();
  private nextTid: number;
  private nextChannel = 0;

  constructor(websocket: Websocket, options: WebSocketMultiplexerOptions) {
    super();

    this.websocket = websocket;
    this.options = options;
    this.nextTid = options.even ? 0 : 1;

    this.websocket.on("message", (raw) => {
      if(typeof raw === "string") {
	// TODO logging
	return;
      }

      if(Array.isArray(raw)) {
	for(const entry of raw) {
	  const msg = decode(entry);
	  this.handleMessage(msg as Msg);
	}
      } else {
	const msg = decode(raw);
	this.handleMessage(msg as Msg);
      }
    });
  }

  createStream(udata: any, cb: CreateCb) {
    const channel = this.nextChannel;
    this.nextChannel += 2;

    this.sendCreate(channel, udata, (err) => {
      if(err != null) {
	cb(err);
	return;
      }

      const stream = this.createMultiplexStream(channel);
      cb(null, stream)
    });
  }

  private sendData(channel: number, data: Buffer | null, cb?: ResponseCb) {
    this.sendRequest({
      t: MsgType.Data,
      c: channel,
      d: data,
    }, cb)
  }

  private sendClose(channel: number, error: Error | null, cb?: ResponseCb) {
    this.sendRequest({
      t: MsgType.Close,
      c: channel,
      e: error != null ? error.message : null,
    }, cb)
  }

  private sendCreate(channel: number, udata: any, cb?: ResponseCb) {
    this.sendRequest({
      t: MsgType.Create,
      c: channel,
      u: udata,
    }, cb)
  }

  private sendRequest(msg: RawMsg, cb?: ResponseCb) {
    const tid = this.nextTid;
    this.nextTid += 1;

    if(cb != null) {
      this.outstanding.set(tid, cb);
    }

    this.sendMessage({ ...msg, i: tid });
  }

  private sendMessage(msg: Msg) {
    const raw = encode(msg);
    this.websocket.send(raw);
  }

  private createResponseCb(tid: number): ResponseCb {
    return (err?: Error | null) => {
      let msg: Msg;

      if(err != null) {
	msg = {
	  t: MsgType.Nack,
	  i: tid,
	  e: err.message,
	}
      } else {
	msg = {
	  t: MsgType.Ack,
	  i: tid,
	}
      }

      this.sendMessage(msg);
    };
  }

  private handleMessage(msg: Msg) {
    switch(msg.t) {
      case MsgType.Ack: {
	this.handleOutstanding(msg.i);
        return;
      }

      case MsgType.Nack: {
	this.handleOutstanding(msg.i, new Error(msg.e));
        return;
      }

      case MsgType.Create: {
	this.handleCreate(msg.c, msg.u, this.createResponseCb(msg.i));
	return;
      }

      case MsgType.Data: {
	this.handleData(msg.c, msg.d, this.createResponseCb(msg.i));
	return;
      }

      case MsgType.Close: {
	const reason = msg.e != null ? new Error(msg.e) : null;
	this.handleClose(msg.c, reason, this.createResponseCb(msg.i));
	return;
      }
    }
  }

  private handleOutstanding(tid: number, err: Error | null = null) {
    const cb = this.outstanding.get(tid);

    if(cb != null) {
      cb(err);
    }
  }

  private handleCreate(channel: number, udata: any, cb: ResponseCb) {
    if(this.oncreate == null) {
      cb(new Error("Unable to create connections"));
      return;
    }

    this.oncreate(udata, (err) => {
      if(err != null) {
	cb(err);
	return;
      }

      cb();
      return this.createMultiplexStream(channel);
    });
  }

  private handleData(channel: number, data: Buffer | null, cb: ResponseCb) {
    const shim = this.shims.get(channel);

    if(shim == null) {
      cb(new Error("Stream not found"));
      return;
    }

    if(shim === false) {
      cb(new Error("Stream closed"));
      return;
    }

    if(shim.receive == null) {
      cb(new Error("Internal error"));
      return;
    }

    shim.receive(data, cb)
  }

  private handleClose(channel: number, reason: Error | null, cb: ResponseCb) {
    const shim = this.shims.get(channel);

    if(shim == null) {
      cb(new Error("Stream not found"));
      return;
    }

    if(shim === false) {
      cb();
      return;
    }

    if(shim.receive_close == null) {
      cb(new Error("Internal error"));
      return;
    }


    shim.receive_close(reason, cb)
  }

  private createMultiplexStream(channel: number) {
    const shim: MultiplexShim = {
      write: this.sendData.bind(this, channel),
      send_close: this.sendClose.bind(this, channel),
    };

    this.shims.set(channel, shim);

    return new MultiplexStream(shim, this.options);
  }
}
