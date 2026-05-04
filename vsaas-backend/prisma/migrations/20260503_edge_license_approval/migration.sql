-- Sprint R7: Workflow de aprovação e suspensão de licenças Edge
-- Adiciona dois estados ao enum EdgeNodeStatus e um valor ao ApprovalAction.

-- EdgeNodeStatus: novos valores PENDING_APPROVAL e SUSPENDED
ALTER TYPE "EdgeNodeStatus" ADD VALUE IF NOT EXISTS 'PENDING_APPROVAL';
ALTER TYPE "EdgeNodeStatus" ADD VALUE IF NOT EXISTS 'SUSPENDED';

-- ApprovalAction: novo valor PROVISION_EDGE_NODE
ALTER TYPE "ApprovalAction" ADD VALUE IF NOT EXISTS 'PROVISION_EDGE_NODE';
