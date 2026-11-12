import type { IncomingHttpHeaders } from 'node:http';
import type { Deployment, XorvReader } from '@xorv/sdk';
import type { Wallet } from '@xorv/sdk/node';
import { HttpError, type Facilitator } from './x402.ts';

/** The eERC private credit lane. Filled in by the eERC integration. */
export class PrivateLane {
  readonly d: Deployment;
  readonly reader: XorvReader;
  readonly desk: Wallet | null;
  readonly facilitator: Facilitator;
  constructor(d: Deployment, reader: XorvReader, desk: Wallet | null, facilitator: Facilitator) {
    this.d = d;
    this.reader = reader;
    this.desk = desk;
    this.facilitator = facilitator;
  }
  async route(method: string, p: string, _body: any, _headers: IncomingHttpHeaders): Promise<[number, unknown]> {
    throw new HttpError(404, `no route ${method} ${p}`);
  }
}
