"""Read-only data access. The Node API owns all writes; this service only reads and calculates."""

from __future__ import annotations

from datetime import date
from functools import lru_cache

import pandas as pd
from sqlalchemy import Engine, create_engine, text

from .config import get_settings


@lru_cache
def get_engine() -> Engine:
    return create_engine(get_settings().sqlalchemy_url, pool_pre_ping=True, pool_size=5)


PAIRS_SQL = text(
    """
    select s.product_id::text  as product_id,
           s.warehouse_id::text as warehouse_id,
           s.quantity           as on_hand,
           coalesce(sup.lead_time_days, 7) as lead_time_days,
           coalesce(oo.qty, 0)  as on_order
    from stock_levels s
    join products p on p.id = s.product_id and p.is_active
    left join suppliers sup on sup.id = p.supplier_id
    left join (
        select poi.product_id, po.warehouse_id, sum(poi.quantity) as qty
        from purchase_order_items poi
        join purchase_orders po on po.id = poi.purchase_order_id
        where po.status in ('SUBMITTED', 'APPROVED')
        group by 1, 2
    ) oo on oo.product_id = s.product_id and oo.warehouse_id = s.warehouse_id
    where (cast(:product_ids as uuid[]) is null or s.product_id = any(cast(:product_ids as uuid[])))
      and (cast(:warehouse_ids as uuid[]) is null or s.warehouse_id = any(cast(:warehouse_ids as uuid[])))
    """
)

SALES_SQL = text(
    """
    select product_id::text as product_id,
           warehouse_id::text as warehouse_id,
           (created_at at time zone 'Asia/Kolkata')::date as day,
           sum(-quantity)::float as qty
    from stock_movements
    where type = 'SALE'
      and created_at >= cast(:since as date)
      and (created_at at time zone 'Asia/Kolkata')::date < cast(:until as date)
      and (cast(:product_ids as uuid[]) is null or product_id = any(cast(:product_ids as uuid[])))
      and (cast(:warehouse_ids as uuid[]) is null or warehouse_id = any(cast(:warehouse_ids as uuid[])))
    group by 1, 2, 3
    """
)


def load_pairs(product_ids: list[str] | None, warehouse_ids: list[str] | None) -> pd.DataFrame:
    with get_engine().connect() as conn:
        return pd.read_sql(PAIRS_SQL, conn, params={"product_ids": product_ids, "warehouse_ids": warehouse_ids})


def load_sales(
    since: date, until: date, product_ids: list[str] | None, warehouse_ids: list[str] | None
) -> pd.DataFrame:
    """Daily sales per product/warehouse in [since, until). Days are Indian calendar days."""
    with get_engine().connect() as conn:
        return pd.read_sql(
            SALES_SQL,
            conn,
            params={"since": since, "until": until, "product_ids": product_ids, "warehouse_ids": warehouse_ids},
        )


def ping() -> bool:
    with get_engine().connect() as conn:
        conn.execute(text("select 1"))
    return True
