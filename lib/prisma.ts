import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

/**
 * 生产环境也要挂到 globalThis。
 * Next 会把每个路由打成独立模块，模块级变量可能被求值多次；
 * 每次 new PrismaClient 都开一条新连接，SQLite 下并发写会互相锁库
 * （表现为随机 500 / "database is locked"）。挂全局后整个进程只有一个客户端。
 */
globalForPrisma.prisma = prisma;
