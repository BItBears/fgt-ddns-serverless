import Core from "@alicloud/pop-core";
import * as https from "https";
import { DnsServer, Params, recordDns } from "./dnsServer";


interface ExtendedParams extends Params {
  bark?: string;        // 兼容简写 token
  "bark-token"?: string; // 兼容长写 token
  "bark-url"?: string;   // 自定义 Bark 服务器基地址 (例如 https://bark.01sec.cn)
  message?: string;      // 自定义推送附加文本/前缀
}
interface RecordType {
  DomainName: string;
  RecordId: string;
  RR: string;
  Type: string;
  Value: string;
  Line: string;
  Priority: number;
  TTL: number;
  Status: string;
  Locked: boolean;
}

function getRecordKey(record: string): string {
  const keys = record.split(".");
  return keys.length > 0 ? keys[0] : record;
}

export class Aliyun extends DnsServer<RecordType> {
  private client: Core;
  private extendedParams: ExtendedParams;
  
  public constructor(p: ExtendedParams) {
    super(p);
    this.extendedParams = p;
    this.client = new Core({
      accessKeyId: this.identifier,
      accessKeySecret: this.secret,
      endpoint: "https://alidns.aliyuncs.com",
      apiVersion: "2015-01-09",
    });
  }
private getBarkToken(): string | undefined {
  return this.extendedParams.bark || this.extendedParams["bark-token"];
}
private getBarkBaseUrl(): string {
    const rawUrl = this.extendedParams["bark-url"] || "https://bark.01sec.cn";
    // 自动清洗末尾的斜杠，防止拼接时出现双斜杠导致 404
    return rawUrl.replace(/\/+$/, "");
}
/**
   * 2. 使用 Node.js 原生 https 模块重写非阻塞推送引擎（彻底消灭编译冲突）
   */
  private triggerBark(actionTitle: string, detail: string): void {
    const token = this.getBarkToken();
    if (!token) return;

    const baseUrl = this.getBarkBaseUrl();
    const customMessage = this.extendedParams.message ? `${this.extendedParams.message}\n` : "";

    // 组装 Bark 规范的 JSON 负载
    const payload = JSON.stringify({
      title: `⚡ ${actionTitle}`,
      body: `${customMessage}域名: ${this.name}.${this.domain}\n状态: ${detail}`,
      sound: "bell",
      group: "BitBears-Gateways",
      level: "active"
    });

    // 拼接完整的请求 URL，并解析成原生请求所需的参数
    const targetFullUrl = `${baseUrl}/${token}`;
    
    try {
      const options = {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Length": Buffer.byteLength(payload)
        },
        timeout: 4000 // 4秒超时控制
      };

      // 发起原生 HTTPS 非阻塞异步请求
      const req = https.request(targetFullUrl, options, (res) => {
        // 消费数据流，防止内存泄漏
        res.on("data", () => {});
      });

      req.on("error", (err) => {
        console.error("Bark 原生推送偶发闪断:", err.message);
      });

      // 强行写入 Payload 报文体并关闭发送流
      req.write(payload);
      req.end();
    } catch (err: any) {
      console.error("Bark 引擎底层初始化异常:", err.message);
    }
  }
  public async addRecord() {
    const params = {
      DomainName: this.domain,
      RR: this.name,
      Type: this.type,
      Value: this.ip,
    };
    const requestOption = {
      method: "POST",
    };
    await this.client.request<{ RequestId: string; RecordId: string }>(
      "AddDomainRecord",
      params,
      requestOption
    );
    // 云端同步成功，异步点火推送
    this.triggerBark("自建 DDNS 初始化成功", `成功创建解析基线 -> ${this.ip}`);
    return true;
  }

  public async getRecord() {
    const result = await this.client.request<{
      RequestId: string;
      TotalCount: number;
      DomainRecords: { Record: RecordType[] };
    }>(
      "DescribeDomainRecords",
      {
        DomainName: this.domain,
        KeyWord: this.name,
        SearchMode: "EXACT",
      },
      {
        method: "POST",
      }
    );
    if (result && result.DomainRecords.Record.length > 0) {
      return result.DomainRecords.Record[0];
    }
    return undefined;
  }

  public isSameRecord(ip: string, record: RecordType) {
    return ip === record.Value;
  }

  public async updateRecord(record: RecordType) {
    const params = {
      RecordId: record.RecordId,
      DomainName: this.domain,
      RR: this.name,
      Type: this.type,
      Value: this.ip,
    };
    await this.client.request<{ RequestId: string; RecordId: string }>(
      "UpdateDomainRecord",
      params,
      {
        method: "POST",
      }
    );
    // 云端变更成功，异步点火推送
    this.triggerBark("自建 DDNS 割接成功", `解析已由 [${record.Value}] 切换至最新基线 [${this.ip}]`);
    return true;
  }
}

module.exports = recordDns(Aliyun);
