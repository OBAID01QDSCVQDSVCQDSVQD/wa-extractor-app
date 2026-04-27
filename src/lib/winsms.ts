export interface SMSResult {
  success: boolean;
  reference?: string;
  error?: string;
}

export class WinSMS {
  private static BASE_URL = 'https://www.winsmspro.com/sms/sms/api';
  private static API_KEY = "fTUG90ao7SI0En1o4Bz0b6g2Xkl1KR4JRHSZJq6KsggzAJKSRXXMUy8Ld18x";
  
  // WinSMS requires the Sender ID to be explicitly provided.
  private static SENDER_ID = "SdkBatimant"; 

  public static normalizeTunisianNumber(phone: string): string {
    const digits = String(phone).replace(/\D/g, '');
    if (digits.length === 8 && /^[24579]/.test(digits)) {
      return '216' + digits;
    }
    return digits;
  }

  private static parseWinSMSError(result: any, httpStatus: number): string {
    if (httpStatus === 429) return "Rate limit exceeded (Too Many Requests)";
    
    const code = Number(result?.code);
    switch (code) {
      case 100: return "Bad gateway (Gateway connection failed)";
      case 101: return "Wrong action or unsupported action";
      case 102: return "Authentication failed (Invalid API key)";
      case 103: return "Invalid phone number format";
      case 105: return "Insufficient balance";
      case 106: return "Invalid sender ID";
      case 111: return "Spam word detected in message";
      case 112: return "Number is blacklisted";
      case 113: return "Maximum allowed numbers exceeded (limit 100)";
      case 555: return "Licence ended or inactive account";
      case 888: return "No Sender ID provided or approved";
      default:
        return result?.message || result?.error || result?.msg || `Unknown error (${code || httpStatus})`;
    }
  }

  private static isSuccess(result: any, rawText?: string): boolean {
    if (rawText && rawText.includes('Successfully Send')) return true;
    if (!result) return false;
    return (
      result.status === 'OK' ||
      result.status === 'ok' ||
      String(result.code) === '100' ||
      result.code === 100 ||
      result.success === true ||
      result.response?.includes('Successfully Send') ||
      result.message?.includes('Successfully Send')
    );
  }

  public static async sendBulkSMS(numbers: string[], message: string): Promise<SMSResult> {
    if (numbers.length === 0) return { success: false, error: 'Empty recipients array' };
    if (numbers.length > 100) return { success: false, error: 'Maximum 100 numbers allowed per request' };

    try {
      const formattedNumbers = numbers.map(n => this.normalizeTunisianNumber(n)).join(',');

      const url = new URL(this.BASE_URL);
      url.searchParams.append('action', 'send-sms');
      url.searchParams.append('api_key', this.API_KEY);
      url.searchParams.append('to', formattedNumbers);
      if (this.SENDER_ID) {
          url.searchParams.append('from', this.SENDER_ID);
      }
      url.searchParams.append('sms', message);

      const response = await fetch(url.toString(), { cache: 'no-store' });
      const text = await response.text();
      
      console.log('WinSMS Raw Response:', text.substring(0, 200));

      if (text.includes('Successfully Send')) return { success: true };

      let result;
      try {
        result = JSON.parse(text);
      } catch (e) {
          // If it's HTML, it's likely a server error from WinSMS
          if (text.trim().startsWith('<')) {
              return { success: false, error: `WinSMS Server Error (HTML returned). Status: ${response.status}` };
          }
          return { success: false, error: `Invalid API response format: ${response.status}` };
      }

      if (this.isSuccess(result, text)) {
        return { success: true, reference: result.reference || result.id_sms };
      }

      return { success: false, error: this.parseWinSMSError(result, response.status) };

    } catch (error: any) {
      console.error('WinSMS Error [sendBulkSMS]:', error);
      return { success: false, error: error.message || 'Connection failed' };
    }
  }
}
