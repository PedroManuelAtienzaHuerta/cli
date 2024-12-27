import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as NetworkUpload from '@internxt/sdk/dist/network/upload';
import { NetworkFacade } from '../../../src/services/network/network-facade.service';
import { SdkManager } from '../../../src/services/sdk-manager.service';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import { UploadService } from '../../../src/services/network/upload.service';
import { CryptoService } from '../../../src/services/crypto.service';
import { DownloadService } from '../../../src/services/network/download.service';
import { Readable } from 'node:stream';
import axios from 'axios';
import { fail } from 'node:assert';
import { UserFixture } from '../../fixtures/auth.fixture';

describe('Network Facade Service', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const getNetworkMock = () => {
    return SdkManager.instance.getNetwork({
      user: 'user',
      pass: 'pass',
    });
  };

  it('When a file is prepared to upload, then it should return the abort controller and upload promise', async () => {
    const sut = new NetworkFacade(
      getNetworkMock(),
      UploadService.instance,
      DownloadService.instance,
      CryptoService.instance,
    );
    const file = path.join(process.cwd(), 'test/fixtures/test-content.fixture.txt');
    const fileStat = await fs.stat(file);
    const readStream = createReadStream(file);
    const options = {
      progressCallback: vi.fn(),
      abortController: new AbortController(),
    };

    const result = await sut.uploadFromStream(
      UserFixture.bucket,
      UserFixture.mnemonic,
      fileStat.size,
      readStream,
      options,
    );

    expect(result[0]).to.be.instanceOf(Promise);
    expect(result[1]).to.be.instanceOf(AbortController);
  });

  it('When a file is uploaded, should return the fileId', async () => {
    const sut = new NetworkFacade(
      getNetworkMock(),
      UploadService.instance,
      DownloadService.instance,
      CryptoService.instance,
    );
    const file = path.join(process.cwd(), 'test/fixtures/test-content.fixture.txt');
    const fileStat = await fs.stat(file);
    const readStream = createReadStream(file);
    const options = {
      progressCallback: vi.fn(),
      abortController: new AbortController(),
    };

    vi.spyOn(NetworkUpload, 'uploadFile').mockResolvedValue('uploaded_file_id');
    const [executeUpload] = await sut.uploadFromStream(
      UserFixture.bucket,
      UserFixture.mnemonic,
      fileStat.size,
      readStream,
      options,
    );

    const uploadResult = await executeUpload;

    expect(uploadResult.fileId).to.be.equal('uploaded_file_id');
  });

  it('When a file is downloaded, should write it to a stream', async () => {
    const encryptedContent = Buffer.from('b6ccfa381c150f3a4b65245bffa4d84087', 'hex');
    const bucket = 'cd8abd7e8b13081660b58dbe';
    const readableContent = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(encryptedContent);
        controller.close();
      },
    });

    const networkMock = getNetworkMock();
    vi.spyOn(networkMock, 'getDownloadLinks').mockResolvedValue({
      index: '29f07b8914d8353b663ab783f4bbe9950fdde680a69524405790cecca9c549f9',
      bucket: bucket,
      created: new Date(),
      size: encryptedContent.length,
      shards: [
        {
          url: 'https://doesnotexists.com/file',
          index: 0,
          size: 17,
          hash: 'a4fc32830aee362a407085f3683f20825a2b21ce',
        },
      ],
      version: 2,
    });
    const downloadServiceStub = DownloadService.instance;
    vi.spyOn(downloadServiceStub, 'downloadFile').mockResolvedValue(readableContent);
    const sut = new NetworkFacade(networkMock, UploadService.instance, downloadServiceStub, CryptoService.instance);

    const chunks: Uint8Array[] = [];

    const writable = new WritableStream<Uint8Array>({
      write(chunk) {
        chunks.push(chunk);
      },
    });

    const [executeDownload] = await sut.downloadToStream(
      bucket,
      // eslint-disable-next-line max-len
      'index course habit soon assist dragon tragic helmet salute stuff later twice consider grit pulse cement obvious trick sponsor stereo hello win royal more',
      'f1858bc9675f9e4f7ab29429',
      encryptedContent.length,
      writable,
    );

    await executeDownload;
    const fileContent = Buffer.concat(chunks);

    expect(fileContent.toString('utf-8')).to.be.equal('encrypted-content');
  });

  it('When a file download is aborted, should abort the download', async () => {
    const encryptedContent = Buffer.from('b6ccfa381c150f3a4b65245bffa4d84087', 'hex');

    const readableContent = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(encryptedContent);
        controller.close();
      },
    });

    const networkMock = getNetworkMock();
    vi.spyOn(networkMock, 'getDownloadLinks').mockResolvedValue({
      index: '29f07b8914d8353b663ab783f4bbe9950fdde680a69524405790cecca9c549f9',
      bucket: UserFixture.bucket,
      created: new Date(),
      size: encryptedContent.length,
      shards: [
        {
          url: 'https://doesnotexists.com/file',
          index: 0,
          size: 17,
          hash: 'a4fc32830aee362a407085f3683f20825a2b21ce',
        },
      ],
      version: 2,
    });
    const downloadServiceStub = DownloadService.instance;
    vi.spyOn(downloadServiceStub, 'downloadFile').mockResolvedValue(readableContent);
    const sut = new NetworkFacade(networkMock, UploadService.instance, downloadServiceStub, CryptoService.instance);

    const writable = new WritableStream<Uint8Array>();

    const [executeDownload, abort] = await sut.downloadToStream(
      UserFixture.bucket,
      // eslint-disable-next-line max-len
      'index course habit soon assist dragon tragic helmet salute stuff later twice consider grit pulse cement obvious trick sponsor stereo hello win royal more',
      'f1858bc9675f9e4f7ab29429',
      encryptedContent.length,
      writable,
    );

    try {
      abort.abort();
      await executeDownload;
      fail('Expected function to throw an error, but it did not.');
    } catch (error) {
      expect((error as Error).message).to.be.equal('Download aborted');
    }
  });

  it('When a file is downloaded, should report progress', async () => {
    const encryptedContent = Buffer.from('b6ccfa381c150f3a4b65245bffa4d84087', 'hex');
    const bucket = 'cd8abd7e8b13081660b58dbe';

    const readableContent = new Readable({
      read() {
        this.push(encryptedContent);
        this.push(null);
      },
    });

    const networkMock = getNetworkMock();
    vi.spyOn(networkMock, 'getDownloadLinks').mockResolvedValue({
      index: '29f07b8914d8353b663ab783f4bbe9950fdde680a69524405790cecca9c549f9',
      bucket: bucket,
      created: new Date(),
      size: encryptedContent.length,
      shards: [
        {
          url: 'https://doesnotexists.com/file',
          index: 0,
          size: 17,
          hash: 'a4fc32830aee362a407085f3683f20825a2b21ce',
        },
      ],
      version: 2,
    });
    const downloadServiceStub = DownloadService.instance;

    const sut = new NetworkFacade(networkMock, UploadService.instance, downloadServiceStub, CryptoService.instance);

    const writable = new WritableStream<Uint8Array>();

    const options = { progressCallback: vi.fn() };

    vi.spyOn(axios, 'get').mockImplementation((_, config) => {
      config?.onDownloadProgress?.({
        loaded: encryptedContent.length,
        total: encryptedContent.length,
        bytes: encryptedContent.length,
        lengthComputable: true,
      });
      return Promise.resolve({ data: readableContent });
    });

    const [executeDownload] = await sut.downloadToStream(
      bucket,
      // eslint-disable-next-line max-len
      'index course habit soon assist dragon tragic helmet salute stuff later twice consider grit pulse cement obvious trick sponsor stereo hello win royal more',
      'f1858bc9675f9e4f7ab29429',
      encryptedContent.length,
      writable,
      undefined,
      options,
    );

    await executeDownload;

    expect(options.progressCallback).toHaveBeenCalledWith(100);
  });
});
