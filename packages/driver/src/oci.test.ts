// oci.ts 的纯函数单测：registry 拆分 + WWW-Authenticate 挑战解析（鉴权流程的两个易错点）。
import { test, expect } from 'bun:test';
import { splitRegistry, parseChallenge } from './oci.ts';

test('splitRegistry：host + 命名空间拆分', () => {
  expect(splitRegistry('ghcr.io/renjiyun06')).toEqual({ host: 'ghcr.io', ns: 'renjiyun06' });
  expect(splitRegistry('ghcr.io/org/sub')).toEqual({ host: 'ghcr.io', ns: 'org/sub' });
  expect(splitRegistry('localhost:5000')).toEqual({ host: 'localhost:5000', ns: '' });
});

test('parseChallenge：解析 Bearer realm/service/scope', () => {
  const h = 'Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:renjiyun06/state:pull"';
  expect(parseChallenge(h)).toEqual({
    realm: 'https://ghcr.io/token',
    service: 'ghcr.io',
    scope: 'repository:renjiyun06/state:pull',
  });
});

test('parseChallenge：缺 scope 也可（realm 必有）', () => {
  expect(parseChallenge('Bearer realm="https://r.io/token",service="r.io"')).toEqual({
    realm: 'https://r.io/token',
    service: 'r.io',
    scope: undefined,
  });
});

test('parseChallenge：非 Bearer / 空 / 无 realm → undefined', () => {
  expect(parseChallenge(null)).toBeUndefined();
  expect(parseChallenge('Basic realm="x"')).toBeUndefined();
  expect(parseChallenge('Bearer service="r.io"')).toBeUndefined();
});
