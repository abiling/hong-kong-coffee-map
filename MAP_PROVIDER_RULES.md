# 地图服务商规则

本文档是 Coffee Shops 数据表、前端和 Apps Script API 处理地图链接时的唯一规则来源。

## 地区规则

- 香港特别行政区和日本使用 Google Maps。
- 中国内地使用 Apple Maps。
- 新增城市必须先加入城市配置，才能接受该城市的数据；地图服务商必须遵循上述地区规则。

## 当前城市映射

| 城市 | 国家／地区 | 必须使用 | 必填字段 | 必须留空的字段 |
| --- | --- | --- | --- | --- |
| Hong Kong | Hong Kong SAR | Google Maps | `google_maps` | `apple_maps` |
| Tokyo | Japan | Google Maps | `google_maps` | `apple_maps` |
| Beijing | China | Apple Maps | `apple_maps` | `google_maps` |

地图服务商由 `country_code` 决定，不能根据设备、浏览器、操作系统或记录中碰巧存在的链接来推断。当前映射为：`HK`、`JP` 使用 Google Maps；`CN` 使用 Apple Maps。

## 数据规则

1. 只保存指定服务商提供的原始、具体商户资料链接。
2. 不根据店名、地址或坐标生成另一家地图服务商的链接。
3. 商户链接缺失时，不用通用搜索链接代替。
4. 新增或更新记录时，城市对应的地图字段必须有值，另一个地图字段写入空字符串。
5. 读取既有记录时不进行破坏性迁移。App 必须忽略并隐藏不属于该城市服务商的链接；只有明确编辑或执行迁移时才覆盖该行。
6. 店铺详情页只显示一个地图按钮。指定的商户链接缺失时不显示替代按钮，并将该记录视为不完整。

## 链接校验

- `google_maps` 必须是 HTTPS Google Maps 链接，包括 `maps.app.goo.gl`、`google.com/maps` 或 Google Maps 的地区域名。
- `apple_maps` 必须是 `maps.apple.com` 的 HTTPS 链接。
- 解析时可以跟随短链接重定向，但最终保存的链接仍须对应同一个具体商户资料。
- 链接服务商与所提交城市不一致时，解析器必须拒绝该链接。

## API 约定

Apps Script API 必须独立执行本规则，不能只依赖前端校验。

### Parse

Google example:

```json
{
  "action": "parse",
  "data": {
    "city": "Tokyo",
    "country_code": "JP",
    "google_maps": "https://maps.app.goo.gl/..."
  }
}
```

Apple example:

```json
{
  "action": "parse",
  "data": {
    "city": "Beijing",
    "country_code": "CN",
    "apple_maps": "https://maps.apple.com/place?..."
  }
}
```

解析结果必须保留 `city`、`country`、`country_code`，并且只返回该国家／地区允许的地图链接字段。

### Add and update

写入 Google Sheets 前，服务端必须：

1. 根据 `country_code` 确定地图服务商，并校验它与 `city` 一致；
2. 校验必填链接；
3. 拒绝缺失或服务商不匹配的链接；
4. 将另一个地图字段设为 `""`；
5. 除非请求明确修改，否则保留所有无关字段的原值。

建议使用以下 Apps Script 写入保护函数：

```javascript
const COUNTRY_MAP_RULES = Object.freeze({
  HK: { provider: 'google', requiredField: 'google_maps', blockedField: 'apple_maps' },
  JP: { provider: 'google', requiredField: 'google_maps', blockedField: 'apple_maps' },
  CN: { provider: 'apple', requiredField: 'apple_maps', blockedField: 'google_maps' }
});

function applyMapProviderRule_(record) {
  const rule = COUNTRY_MAP_RULES[String(record.country_code || '').toUpperCase()];
  if (!rule) throw new Error('Unsupported country/region');

  const url = String(record[rule.requiredField] || '').trim();
  if (!url) throw new Error(rule.requiredField + ' is required for ' + record.country_code);
  validateProviderUrl_(rule.provider, url);

  record[rule.requiredField] = url;
  record[rule.blockedField] = '';
  return record;
}

function validateProviderUrl_(provider, value) {
  const url = String(value || '').trim();
  const isApple = /^https:\/\/maps\.apple\.com(?:\/|\?)/i.test(url);
  const isGoogle = /^https:\/\/(?:maps\.app\.goo\.gl\/|goo\.gl\/maps\/|(?:[^/]+\.)?google\.[a-z.]+\/maps(?:\/|\?|$))/i.test(url);
  if (provider === 'apple' && !isApple) throw new Error('A maps.apple.com merchant link is required');
  if (provider === 'google' && !isGoogle) throw new Error('A Google Maps merchant link is required');
}
```

## 坐标

北京 Apple Maps 商户链接中的高德系坐标按 GCJ-02 处理；Apps Script API 在写入前将其转换为当前 MapLibre/OpenFreeMap 底图使用的 WGS-84 坐标。解析结果同时返回 `source_coordinate` 供人工核对，但数据表的 `latitude`、`longitude` 只保存转换后的 WGS-84 坐标。首批北京数据仍须逐店验证，不能跳过人工确认。
