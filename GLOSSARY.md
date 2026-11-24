# orange-invest

A chat assistant that answers questions about a person's own money, using the bank statements they
upload.

## Money movement

**Transaction**:
One line of a bank statement: a dated movement of money into or out of the user's account, with an
amount, a direction and a description.
_Avoid_: entry, record, txn (in prose)

**Direction**:
Whether a transaction took money out of the account (**debit**) or put money in (**credit**). An
amount is always positive; the direction carries the sign.
_Avoid_: negative amount, withdrawal/deposit (as a general term)

**Merchant**:
The cleaned-up name of who the money went to or came from, as read from a transaction's
description (e.g. "Swiggy"). A merchant can be a business or a person.
_Avoid_: payee, vendor, counterparty

**Category**:
One label from the fixed list that says what a transaction was for (e.g. Food delivery, Rent,
Salary). Every transaction has exactly one.
_Avoid_: tag, type, bucket

**Unidentified**:
The category of a transaction that neither the rules nor the LLM fallback could place in any other
category with confidence.
_Avoid_: Other, Uncategorised, Misc

**Spend**:
The total of debit transactions whose category is neither Self-transfer nor Investments. Every
"how much did I spend" answer means exactly this.
_Avoid_: expenses, outflow, debits (they're broader than spend)

**Self-transfer**:
Money the user moved between their own accounts. It is not spend.
_Avoid_: internal transfer, own transfer

**Investments**:
Money the user put into an investment (SIP, mutual fund, stocks, PPF/NPS). It is not spend.
_Avoid_: savings

**Person-to-person payment (P2P)**:
A transfer to or from a private individual rather than a business, e.g. splitting a dinner bill
over UPI. Its category is Transfers (others) unless a keyword says otherwise (rent, a self transfer).
A person's name is never sent to the LLM or stored in the shared merchant cache.
_Avoid_: friend payment, peer transfer

## Ingestion

**Upload**:
One bank-statement file a user sent in, and the transactions it brought in.
_Avoid_: import, file (for the stored record)

**Duplicate**:
A transaction in an upload that the user already has, from the same file or an earlier upload.
It is counted but not stored again.
_Avoid_: repeat, overlap

**Categorisation**:
Giving each transaction its category: rules first, then the shared merchant cache, then one LLM
call for merchants still unknown, then Unidentified.
_Avoid_: classification (except for the LLM step), tagging

## Asking questions

**Period**:
The span of calendar days, in IST, that a question is about. "This month" and other periods still
under way end today.
_Avoid_: date range, timeframe

**Last month**:
The whole calendar month before the current one, not the last 30 days.
_Avoid_: past month, previous 30 days

**This week**:
Monday to today, in IST.
_Avoid_: last 7 days (that's a different period)

**A month named without a year**:
"October" on its own means the most recent October that has already started. Asked in November
2026 it is October 2026; asked in September 2026 it is October 2025.

**Monthly average**:
Spend divided by the number of complete calendar months, counted from the month of the user's
first transaction. The current, unfinished month is never counted.
_Avoid_: average per month (for partial months)

**Recurring payment**:
A debit to the same merchant in three or more different months, at an amount within 10% of that
merchant's usual amount each time (rent, EMIs, subscriptions, SIPs). Self-transfers are not
recurring payments.
_Avoid_: subscription (it's only one kind)

**Conversation**:
One chat thread. The assistant remembers earlier messages in the same conversation, never across
conversations.
_Avoid_: chat, session, thread
