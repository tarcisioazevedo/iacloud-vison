/**
 * asaas-webhook-processor — tests unitários dos handlers de eventos.
 *
 * Cobre os 11 eventos tratados, com payloads compatíveis com o formato real
 * do Asaas v3. Mocka prisma e sendMail; valida apenas mutações de DB e
 * efeitos colaterais (emails enviados).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../lib/prisma', () => ({
  prisma: {
    invoice: {
      findUnique: vi.fn(),
      update:     vi.fn(),
    },
    integrador: {
      findUnique: vi.fn(),
    },
    asaasSubscription: {
      findUnique: vi.fn(),
    },
    clienteSubscription: {
      findMany:   vi.fn(),
      updateMany: vi.fn(),
    },
    clienteFinal: {
      findUnique: vi.fn(),
    },
  },
}))

vi.mock('../lib/smtp', () => ({
  sendMail: vi.fn().mockResolvedValue(undefined),
}))

import { __testables__ } from './asaas-webhook-processor.service'
import { prisma } from '../lib/prisma'
import { sendMail } from '../lib/smtp'

const mockPrisma = prisma as unknown as {
  invoice:             { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> }
  integrador:          { findUnique: ReturnType<typeof vi.fn> }
  asaasSubscription:   { findUnique: ReturnType<typeof vi.fn> }
  clienteSubscription: { findMany: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> }
  clienteFinal:        { findUnique: ReturnType<typeof vi.fn> }
}
const mockSendMail = sendMail as unknown as ReturnType<typeof vi.fn>

// Fixture do payload Asaas (formato v3 documentado)
function paymentEvent(eventName: string, overrides: Partial<any> = {}) {
  return {
    id:           'evt_test_' + eventName,
    payloadJson: {
      id:    'evt_' + eventName.toLowerCase(),
      event: eventName,
      payment: {
        id:                  'pay_abc123',
        subscription:        'sub_xyz789',
        externalReference:   'integ_acme',
        value:               99.9,
        status:              eventName.replace('PAYMENT_', ''),
        ...overrides.payment,
      },
      ...overrides,
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  // Invoice padrão encontrada
  mockPrisma.invoice.findUnique.mockResolvedValue({ id: 'inv_1', integradorId: 'integ_acme' })
  mockPrisma.invoice.update.mockResolvedValue({})
})

// ─── extractors ───────────────────────────────────────────────────────────────

describe('extractPaymentId', () => {
  it('lê payment.id quando presente', () => {
    expect(__testables__.extractPaymentId({ payment: { id: 'pay_123' } })).toBe('pay_123')
  })

  it('fallback pra payload.id (eventos sem payment)', () => {
    expect(__testables__.extractPaymentId({ id: 'pay_456' })).toBe('pay_456')
  })

  it('retorna null quando nenhum disponível', () => {
    expect(__testables__.extractPaymentId({})).toBeNull()
  })
})

describe('extractSubscriptionId', () => {
  it('lê subscription.id', () => {
    expect(__testables__.extractSubscriptionId({ subscription: { id: 'sub_123' } })).toBe('sub_123')
  })

  it('fallback pra payment.subscription', () => {
    expect(__testables__.extractSubscriptionId({ payment: { subscription: 'sub_456' } })).toBe('sub_456')
  })

  it('null sem match', () => {
    expect(__testables__.extractSubscriptionId({})).toBeNull()
  })
})

// ─── updateInvoiceStatus ──────────────────────────────────────────────────────

describe('updateInvoiceStatus', () => {
  it('atualiza Invoice quando achada pelo asaasPaymentId', async () => {
    const r = await __testables__.updateInvoiceStatus(
      { payment: { id: 'pay_abc' } },
      'PENDING',
    )
    expect(r).toEqual({ id: 'inv_1', integradorId: 'integ_acme' })
    expect(mockPrisma.invoice.findUnique).toHaveBeenCalledWith({
      where:  { asaasPaymentId: 'pay_abc' },
      select: { id: true, integradorId: true },
    })
    expect(mockPrisma.invoice.update).toHaveBeenCalledWith({
      where: { id: 'inv_1' },
      data:  { status: 'PENDING' },
    })
  })

  it('seta paidAt quando newStatus=PAID', async () => {
    await __testables__.updateInvoiceStatus({ payment: { id: 'pay_abc' } }, 'PAID')
    const call = mockPrisma.invoice.update.mock.calls[0][0]
    expect(call.data.status).toBe('PAID')
    expect(call.data.paidAt).toBeInstanceOf(Date)
  })

  it('retorna null quando payment não tem id', async () => {
    const r = await __testables__.updateInvoiceStatus({ payment: {} }, 'PENDING')
    expect(r).toBeNull()
    expect(mockPrisma.invoice.update).not.toHaveBeenCalled()
  })

  it('retorna null quando Invoice não existe (cobrança avulsa)', async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue(null)
    const r = await __testables__.updateInvoiceStatus({ payment: { id: 'pay_xxx' } }, 'PENDING')
    expect(r).toBeNull()
    expect(mockPrisma.invoice.update).not.toHaveBeenCalled()
  })
})

// ─── handlers de risk analysis ───────────────────────────────────────────────

describe('handleRiskPending', () => {
  it('seta Invoice como RISK_PENDING sem disparar email', async () => {
    await __testables__.handleRiskPending(paymentEvent('PAYMENT_AWAITING_RISK_ANALYSIS'))
    expect(mockPrisma.invoice.update).toHaveBeenCalledWith({
      where: { id: 'inv_1' },
      data:  { status: 'RISK_PENDING' },
    })
    expect(mockSendMail).not.toHaveBeenCalled()
  })
})

describe('handleRiskApproved', () => {
  it('volta status pra PENDING quando análise aprovou', async () => {
    await __testables__.handleRiskApproved(paymentEvent('PAYMENT_APPROVED_BY_RISK_ANALYSIS'))
    expect(mockPrisma.invoice.update).toHaveBeenCalledWith({
      where: { id: 'inv_1' },
      data:  { status: 'PENDING' },
    })
  })
})

describe('handleRiskDenied', () => {
  it('marca RISK_DENIED e envia email ao integrador', async () => {
    mockPrisma.integrador.findUnique.mockResolvedValue({
      nome: 'Integrador ACME',
      users: [{ email: 'admin@acme.com' }],
    })
    await __testables__.handleRiskDenied(paymentEvent('PAYMENT_REPROVED_BY_RISK_ANALYSIS'))
    expect(mockPrisma.invoice.update).toHaveBeenCalledWith({
      where: { id: 'inv_1' },
      data:  { status: 'RISK_DENIED' },
    })
    expect(mockSendMail).toHaveBeenCalledOnce()
    const sent = mockSendMail.mock.calls[0][0]
    expect(sent.to).toBe('admin@acme.com')
    expect(sent.subject).toContain('Cartão recusado')
  })

  it('não quebra se integrador não tiver email', async () => {
    mockPrisma.integrador.findUnique.mockResolvedValue({ nome: 'X', users: [] })
    await expect(
      __testables__.handleRiskDenied(paymentEvent('PAYMENT_REPROVED_BY_RISK_ANALYSIS')),
    ).resolves.not.toThrow()
    expect(mockSendMail).not.toHaveBeenCalled()
  })

  it('não envia email se Invoice não foi encontrada', async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue(null)
    await __testables__.handleRiskDenied(paymentEvent('PAYMENT_REPROVED_BY_RISK_ANALYSIS'))
    expect(mockPrisma.integrador.findUnique).not.toHaveBeenCalled()
    expect(mockSendMail).not.toHaveBeenCalled()
  })
})

// ─── handlers de refund ──────────────────────────────────────────────────────

describe('handleRefunded', () => {
  it('marca Invoice como REFUNDED', async () => {
    await __testables__.handleRefunded(paymentEvent('PAYMENT_REFUNDED'))
    expect(mockPrisma.invoice.update).toHaveBeenCalledWith({
      where: { id: 'inv_1' },
      data:  { status: 'REFUNDED' },
    })
  })
})

describe('handlePartiallyRefunded', () => {
  it('marca Invoice como PARTIALLY_REFUNDED', async () => {
    await __testables__.handlePartiallyRefunded(paymentEvent('PAYMENT_PARTIALLY_REFUNDED'))
    expect(mockPrisma.invoice.update).toHaveBeenCalledWith({
      where: { id: 'inv_1' },
      data:  { status: 'PARTIALLY_REFUNDED' },
    })
  })
})

// ─── handlers de delete/restore ──────────────────────────────────────────────

describe('handlePaymentDeleted', () => {
  it('marca Invoice como CANCELLED', async () => {
    await __testables__.handlePaymentDeleted(paymentEvent('PAYMENT_DELETED'))
    expect(mockPrisma.invoice.update).toHaveBeenCalledWith({
      where: { id: 'inv_1' },
      data:  { status: 'CANCELLED' },
    })
  })
})

describe('handlePaymentRestored', () => {
  it('reverte CANCELLED → PENDING', async () => {
    await __testables__.handlePaymentRestored(paymentEvent('PAYMENT_RESTORED'))
    expect(mockPrisma.invoice.update).toHaveBeenCalledWith({
      where: { id: 'inv_1' },
      data:  { status: 'PENDING' },
    })
  })
})

// ─── handlers de subscription overdue / paid ────────────────────────────────

describe('handleOverdue', () => {
  beforeEach(() => {
    mockPrisma.asaasSubscription.findUnique.mockResolvedValue({ integradorId: 'integ_acme' })
    mockPrisma.clienteSubscription.findMany.mockResolvedValue([
      { id: 'cs_1', clienteFinalId: 'cf_1' },
      { id: 'cs_2', clienteFinalId: 'cf_1' },
    ])
    mockPrisma.clienteFinal.findUnique.mockResolvedValue({
      tradeName: 'Loja X', name: 'Loja X LTDA', users: [{ email: 'loja@x.com' }],
    })
  })

  it('suspende ClienteSubscriptions do integrador', async () => {
    await __testables__.handleOverdue({
      id: 'evt_1',
      payloadJson: {
        event: 'PAYMENT_OVERDUE',
        payment: { subscription: 'sub_xyz789', externalReference: 'integ_acme' },
      },
    })
    expect(mockPrisma.clienteSubscription.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['cs_1', 'cs_2'] } },
      data:  expect.objectContaining({ status: 'SUSPENDED' }),
    })
    expect(mockSendMail).toHaveBeenCalledOnce()
    expect(mockSendMail.mock.calls[0][0].subject).toContain('suspenso')
  })

  it('no-op quando integrador não tem subs ativas', async () => {
    mockPrisma.clienteSubscription.findMany.mockResolvedValue([])
    await __testables__.handleOverdue({
      id: 'evt_1',
      payloadJson: {
        event: 'PAYMENT_OVERDUE',
        payment: { subscription: 'sub_xyz789' },
      },
    })
    expect(mockPrisma.clienteSubscription.updateMany).not.toHaveBeenCalled()
  })
})

// ─── handlers críticos: chargeback / balance block / account rejected ────────

describe('handleRefundDenied', () => {
  it('envia email crítico ao admin fabricante', async () => {
    await __testables__.handleRefundDenied({
      id: 'evt_x',
      payloadJson: { event: 'PAYMENT_REFUND_DENIED', payment: { id: 'pay_abc' } },
    })
    expect(mockSendMail).toHaveBeenCalledOnce()
    expect(mockSendMail.mock.calls[0][0].subject).toContain('Estorno negado')
  })
})

describe('handleChargeback', () => {
  it('alerta admin com valor e estágio', async () => {
    await __testables__.handleChargeback({
      id: 'evt_x',
      payloadJson: {
        event: 'PAYMENT_CHARGEBACK_REQUESTED',
        payment: { id: 'pay_xx', value: 250 },
      },
    })
    const sent = mockSendMail.mock.calls[0][0]
    expect(sent.subject).toContain('Chargeback aberta')
    expect(sent.text).toContain('250')
  })

  it('distingue os 3 estágios de chargeback', async () => {
    for (const evt of ['PAYMENT_CHARGEBACK_REQUESTED', 'PAYMENT_CHARGEBACK_DISPUTE', 'PAYMENT_AWAITING_CHARGEBACK_REVERSAL']) {
      mockSendMail.mockClear()
      await __testables__.handleChargeback({
        id: 'evt_x', payloadJson: { event: evt, payment: { id: 'p1', value: 100 } },
      })
      expect(mockSendMail).toHaveBeenCalledOnce()
    }
  })
})

describe('handleBalanceBlocked', () => {
  it('marca log error e envia alerta crítico', async () => {
    await __testables__.handleBalanceBlocked({
      id: 'evt_x',
      payloadJson: { event: 'BALANCE_VALUE_BLOCKED', value: 5000, reason: 'Penhora judicial' },
    })
    const sent = mockSendMail.mock.calls[0][0]
    expect(sent.subject).toContain('SALDO BLOQUEADO')
    expect(sent.text).toContain('5000')
    expect(sent.text).toContain('Penhora')
  })
})

describe('handleBalanceUnblocked', () => {
  it('envia email informativo', async () => {
    await __testables__.handleBalanceUnblocked({
      id: 'evt_x',
      payloadJson: { event: 'BALANCE_VALUE_UNBLOCKED', value: 5000 },
    })
    expect(mockSendMail.mock.calls[0][0].subject).toContain('liberado')
  })
})

describe('handleAccountCritical', () => {
  it('alerta admin para REJECTED', async () => {
    await __testables__.handleAccountCritical({
      id: 'evt_x',
      payloadJson: { event: 'ACCOUNT_STATUS_GENERAL_APPROVAL_REJECTED' },
    })
    const sent = mockSendMail.mock.calls[0][0]
    expect(sent.subject).toContain('aprovação geral reprovada')
  })

  it('alerta admin para DOCUMENT_REJECTED', async () => {
    await __testables__.handleAccountCritical({
      id: 'evt_x',
      payloadJson: { event: 'ACCOUNT_STATUS_DOCUMENT_REJECTED' },
    })
    expect(mockSendMail.mock.calls[0][0].subject).toContain('documentos reprovada')
  })

  it('alerta admin para EXPIRED (commercial info)', async () => {
    await __testables__.handleAccountCritical({
      id: 'evt_x',
      payloadJson: { event: 'ACCOUNT_STATUS_COMMERCIAL_INFO_EXPIRED' },
    })
    expect(mockSendMail.mock.calls[0][0].subject).toContain('expirada')
  })
})

describe('handleAccountInfo', () => {
  it('não dispara email para eventos informativos', async () => {
    await __testables__.handleAccountInfo({
      id: 'evt_x',
      payloadJson: { event: 'ACCOUNT_STATUS_GENERAL_APPROVAL_APPROVED' },
    })
    expect(mockSendMail).not.toHaveBeenCalled()
  })
})

describe('handlePaid', () => {
  it('reativa ClienteSubscriptions SUSPENDED', async () => {
    mockPrisma.asaasSubscription.findUnique.mockResolvedValue({ integradorId: 'integ_acme' })
    mockPrisma.clienteSubscription.findMany.mockResolvedValue([
      { id: 'cs_3', clienteFinalId: 'cf_2' },
    ])
    mockPrisma.clienteFinal.findUnique.mockResolvedValue({
      tradeName: 'Y', name: 'Y', users: [{ email: 'y@y.com' }],
    })
    await __testables__.handlePaid({
      id: 'evt_2',
      payloadJson: {
        event: 'PAYMENT_RECEIVED',
        payment: { subscription: 'sub_xyz789' },
      },
    })
    expect(mockPrisma.clienteSubscription.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['cs_3'] } },
      data:  expect.objectContaining({ status: 'ACTIVE' }),
    })
    expect(mockSendMail).toHaveBeenCalledOnce()
    expect(mockSendMail.mock.calls[0][0].subject).toContain('reativado')
  })
})
