/**
 * Keep-Alive Service for Render Deployment
 * 
 * Prevents the Render app from going idle by pinging the health endpoint
 * at regular intervals. Optimized for paid Render tier with 5-minute intervals.
 * 
 * Features:
 * - Only activates when deployed on Render (checks RENDER env var)
 * - Pings every 5 minutes (300,000ms) for optimal uptime
 * - Comprehensive logging for monitoring
 * - Graceful error handling with retry logic
 * - Response time tracking
 */

import type { MastraLogger } from "@mastra/core/logger";

interface KeepAliveConfig {
  url: string;
  intervalMs: number;
  logger?: MastraLogger;
}

interface PingResult {
  success: boolean;
  statusCode?: number;
  responseTime: number;
  error?: string;
}

export class KeepAliveService {
  private config: KeepAliveConfig;
  private intervalId?: NodeJS.Timeout;
  private pingCount = 0;
  private successCount = 0;
  private failureCount = 0;
  private lastPingTime?: Date;
  private isRunning = false;

  constructor(config: KeepAliveConfig) {
    this.config = config;
  }

  /**
   * Start the keep-alive service
   * Only runs if RENDER environment variable is present
   */
  start(): void {
    // Only activate on Render
    if (!process.env.RENDER) {
      this.config.logger?.info("⏸️  [Keep-Alive] Not running on Render, keep-alive disabled");
      return;
    }

    if (this.isRunning) {
      this.config.logger?.warn("⚠️  [Keep-Alive] Service already running");
      return;
    }

    this.isRunning = true;
    this.config.logger?.info("🚀 [Keep-Alive] Service starting", {
      url: this.config.url,
      intervalMinutes: this.config.intervalMs / 60000,
      intervalMs: this.config.intervalMs,
    });

    // Run initial ping immediately
    this.ping();

    // Schedule periodic pings
    this.intervalId = setInterval(() => {
      this.ping();
    }, this.config.intervalMs);

    this.config.logger?.info("✅ [Keep-Alive] Service started successfully");
  }

  /**
   * Stop the keep-alive service
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
      this.isRunning = false;
      
      this.config.logger?.info("🛑 [Keep-Alive] Service stopped", {
        totalPings: this.pingCount,
        successCount: this.successCount,
        failureCount: this.failureCount,
        uptime: this.getStats(),
      });
    }
  }

  /**
   * Perform a single ping to the health endpoint
   */
  private async ping(): Promise<PingResult> {
    const startTime = Date.now();
    this.pingCount++;
    this.lastPingTime = new Date();

    try {
      this.config.logger?.debug("🏓 [Keep-Alive] Pinging endpoint", {
        url: this.config.url,
        pingNumber: this.pingCount,
      });

      const response = await fetch(this.config.url, {
        method: "GET",
        headers: {
          "User-Agent": "KeepAlive-Service/1.0",
        },
        signal: AbortSignal.timeout(10000), // 10 second timeout
      });

      const responseTime = Date.now() - startTime;
      const success = response.ok;

      if (success) {
        this.successCount++;
        this.config.logger?.info("✅ [Keep-Alive] Ping successful", {
          statusCode: response.status,
          responseTime,
          pingNumber: this.pingCount,
          successRate: `${((this.successCount / this.pingCount) * 100).toFixed(1)}%`,
        });
      } else {
        this.failureCount++;
        this.config.logger?.warn("⚠️  [Keep-Alive] Ping returned non-OK status", {
          statusCode: response.status,
          responseTime,
          pingNumber: this.pingCount,
          failureCount: this.failureCount,
        });
      }

      return {
        success,
        statusCode: response.status,
        responseTime,
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      this.failureCount++;

      const errorMessage = error instanceof Error ? error.message : String(error);
      
      this.config.logger?.error("❌ [Keep-Alive] Ping failed", {
        error: errorMessage,
        responseTime,
        pingNumber: this.pingCount,
        failureCount: this.failureCount,
        successRate: `${((this.successCount / this.pingCount) * 100).toFixed(1)}%`,
      });

      // Retry once after a short delay if it's a network error
      if (errorMessage.includes("fetch") || errorMessage.includes("network")) {
        this.config.logger?.info("🔄 [Keep-Alive] Retrying in 5 seconds...");
        await new Promise((resolve) => setTimeout(resolve, 5000));
        return this.retryPing(startTime);
      }

      return {
        success: false,
        responseTime,
        error: errorMessage,
      };
    }
  }

  /**
   * Retry a failed ping once
   */
  private async retryPing(originalStartTime: number): Promise<PingResult> {
    try {
      this.config.logger?.debug("🔄 [Keep-Alive] Retry attempt");

      const response = await fetch(this.config.url, {
        method: "GET",
        headers: {
          "User-Agent": "KeepAlive-Service/1.0",
        },
        signal: AbortSignal.timeout(10000),
      });

      const responseTime = Date.now() - originalStartTime;
      const success = response.ok;

      if (success) {
        // Adjust counts since we're fixing a previous failure
        this.successCount++;
        this.failureCount--;
        
        this.config.logger?.info("✅ [Keep-Alive] Retry successful", {
          statusCode: response.status,
          responseTime,
        });
      }

      return {
        success,
        statusCode: response.status,
        responseTime,
      };
    } catch (error) {
      const responseTime = Date.now() - originalStartTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      this.config.logger?.error("❌ [Keep-Alive] Retry failed", {
        error: errorMessage,
        responseTime,
      });

      return {
        success: false,
        responseTime,
        error: errorMessage,
      };
    }
  }

  /**
   * Get current statistics
   */
  getStats() {
    return {
      isRunning: this.isRunning,
      pingCount: this.pingCount,
      successCount: this.successCount,
      failureCount: this.failureCount,
      successRate: this.pingCount > 0 
        ? `${((this.successCount / this.pingCount) * 100).toFixed(1)}%` 
        : "0%",
      lastPingTime: this.lastPingTime?.toISOString(),
    };
  }
}

/**
 * Initialize and start the keep-alive service
 * @param baseUrl - The base URL of the application (e.g., https://stirlo-stirling.onrender.com)
 * @param logger - Optional Mastra logger for monitoring
 * @returns KeepAliveService instance
 */
export function startKeepAlive(baseUrl: string, logger?: MastraLogger): KeepAliveService {
  const healthUrl = `${baseUrl}/api/health`;
  
  const service = new KeepAliveService({
    url: healthUrl,
    intervalMs: 5 * 60 * 1000, // 5 minutes (optimized for paid Render tier)
    logger,
  });

  service.start();
  
  return service;
}
