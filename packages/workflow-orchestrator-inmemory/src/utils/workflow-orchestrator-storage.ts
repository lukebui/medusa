import {
  DistributedTransaction,
  DistributedTransactionStorage,
  TransactionCheckpoint,
  TransactionStep,
} from "@medusajs/orchestration"
import {
  WorkflowExecutionService,
  WorkflowOrchestratorService,
} from "@services"
import { TransactionState } from "@medusajs/utils"

// eslint-disable-next-line max-len
export class InMemoryDistributedTransactionStorage extends DistributedTransactionStorage {
  private workflowExecutionService_: WorkflowExecutionService
  private workflowOrchestratorService_: WorkflowOrchestratorService

  private storage: Map<string, TransactionCheckpoint> = new Map()
  private retries: Map<string, unknown> = new Map()
  private timeouts: Map<string, unknown> = new Map()

  constructor({
    workflowExecutionService,
  }: {
    workflowExecutionService: WorkflowExecutionService
  }) {
    super()

    this.workflowExecutionService_ = workflowExecutionService
  }

  setWorkflowOrchestratorService(workflowOrchestratorService) {
    this.workflowOrchestratorService_ = workflowOrchestratorService
  }

  private async saveToDb(data: TransactionCheckpoint) {
    await this.workflowExecutionService_.upsert([
      {
        workflow_id: data.flow.modelId,
        transaction_id: data.flow.transactionId,
        definition: JSON.stringify(data.flow.definition),
        context: JSON.stringify({
          data: data.context,
          errors: data.errors,
        }),
        state: data.flow.state,
      },
    ])
  }

  async get(key: string): Promise<TransactionCheckpoint | undefined> {
    return this.storage.get(key)
  }

  async list(): Promise<TransactionCheckpoint[]> {
    return Array.from(this.storage.values())
  }

  async save(
    key: string,
    data: TransactionCheckpoint,
    ttl?: number
  ): Promise<void> {
    this.storage.set(key, data)

    let retentionTime

    /**
     * Store the rentention time only if the transaction is done, failed or reverted.
     * From that moment, this tuple can be later on archived or deleted after the retention time.
     */
    const finalStatus = [
      TransactionState.DONE,
      TransactionState.FAILED,
      TransactionState.REVERTED,
    ]
    const isFinalStatus = finalStatus.includes(data.flow.state)

    if (isFinalStatus) {
      retentionTime = data.flow.options?.retentionTime
      Object.assign(data, {
        retention_time: retentionTime,
      })
    }

    await this.saveToDb(data)

    if (isFinalStatus) {
      this.storage.delete(key)
    }
  }

  async delete(key: string): Promise<void> {
    this.storage.delete(key)
  }

  async scheduleRetry(
    transaction: DistributedTransaction,
    step: TransactionStep,
    timestamp: number,
    interval: number
  ): Promise<void> {
    const { modelId: workflowId, transactionId } = transaction

    const inter = setTimeout(async () => {
      await this.workflowOrchestratorService_.run(workflowId, {
        transactionId,
        throwOnError: false,
      })
    }, interval * 1e3)

    const key = `${workflowId}:${transactionId}:${step.id}`
    this.retries.set(key, inter)
  }

  async clearRetry(
    transaction: DistributedTransaction,
    step: TransactionStep
  ): Promise<void> {
    const { modelId: workflowId, transactionId } = transaction

    const key = `${workflowId}:${transactionId}:${step.id}`
    const inter = this.retries.get(key)
    if (inter) {
      clearTimeout(inter as NodeJS.Timeout)
      this.retries.delete(key)
    }
  }

  async scheduleTransactionTimeout(
    transaction: DistributedTransaction,
    timestamp: number,
    interval: number
  ): Promise<void> {
    const { modelId: workflowId, transactionId } = transaction

    const inter = setTimeout(async () => {
      await this.workflowOrchestratorService_.run(workflowId, {
        transactionId,
        throwOnError: false,
      })
    }, interval * 1e3)

    const key = `${workflowId}:${transactionId}`
    this.timeouts.set(key, inter)
  }

  async clearTransactionTimeout(
    transaction: DistributedTransaction
  ): Promise<void> {
    const { modelId: workflowId, transactionId } = transaction

    const key = `${workflowId}:${transactionId}`
    const inter = this.timeouts.get(key)
    if (inter) {
      clearTimeout(inter as NodeJS.Timeout)
      this.timeouts.delete(key)
    }
  }

  async scheduleStepTimeout(
    transaction: DistributedTransaction,
    step: TransactionStep,
    timestamp: number,
    interval: number
  ): Promise<void> {
    const { modelId: workflowId, transactionId } = transaction

    const inter = setTimeout(async () => {
      await this.workflowOrchestratorService_.run(workflowId, {
        transactionId,
        throwOnError: false,
      })
    }, interval * 1e3)

    const key = `${workflowId}:${transactionId}:${step.id}`
    this.timeouts.set(key, inter)
  }

  async clearStepTimeout(
    transaction: DistributedTransaction,
    step: TransactionStep
  ): Promise<void> {
    const { modelId: workflowId, transactionId } = transaction

    const key = `${workflowId}:${transactionId}:${step.id}`
    const inter = this.timeouts.get(key)
    if (inter) {
      clearTimeout(inter as NodeJS.Timeout)
      this.timeouts.delete(key)
    }
  }
}
