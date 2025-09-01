import express, { Request, Response } from 'express';
import { AlienSsoSdkClient } from '../../src/client';
import fetch from 'cross-fetch';
import * as http from 'node:http';
import { AlienSsoSdkServer } from '../../src/server';
import { AuthenticationError, ValidationError } from '../../src/errors';
import { initializeLocalStorageMock, initializeSsoMock } from '../mock';

global.fetch = fetch;

const config = {
  providerAddress: '00000001000000000000000000000000',
  providerPrivateKey:
    'c366d7b8eb1396a486d6a8f8ed1ae5a94b9923264e827e9e33aa6d4b702cf177',
};

const SSO_BASE_URL = 'http://localhost:3001';

describe('SSO Integration', () => {
  let clientSdk: AlienSsoSdkClient;
  let serverSdk: AlienSsoSdkServer;
  let server: http.Server;
  let serverAddress: string;
  let app: express.Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    server = app.listen(0);
    const address = server.address();
    serverAddress =
      typeof address === 'string'
        ? address
        : `http://localhost:${address?.port}`;

    clientSdk = new AlienSsoSdkClient({
      serverSdkBaseUrl: serverAddress,
      ssoBaseUrl: SSO_BASE_URL,
    });
    serverSdk = new AlienSsoSdkServer({
      providerPrivateKey: config.providerPrivateKey,
      providerAddress: config.providerAddress,
      ssoBaseUrl: SSO_BASE_URL,
    });

    app.post('/authorize', async (req: Request, res: Response) => {
      try {
        const { code_challenge } = req.body;
        const response = await serverSdk.authorize(code_challenge);
        return res.json(response);
      } catch (err: unknown) {
        if (err instanceof ValidationError) {
          return res.status(400).json({
            error: {
              name: err.name,
              message: err.message,
            },
          });
        } else if (err instanceof AuthenticationError) {
          return res.status(401).json({
            error: {
              name: err.name,
              message: err.message,
            },
          });
        } else if (err instanceof Error) {
          console.error(err);
          return res.status(500).json({
            error: {
              name: err.name,
              message: err.message,
            },
          });
        } else {
          return res.status(500);
        }
      }
    });

    initializeLocalStorageMock();
    initializeSsoMock(SSO_BASE_URL);
  });

  afterAll(() => {
    server.close();
  });

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('successful SSO flow', async () => {
    const authorizeResponse = await clientSdk.authorize();

    expect(authorizeResponse).toEqual({
      deep_link: expect.any(String),
      polling_code: expect.any(String),
      expired_at: expect.any(Number),
    });
  });
});
