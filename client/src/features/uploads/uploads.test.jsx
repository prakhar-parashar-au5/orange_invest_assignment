import { describe, it, expect } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { renderApp } from '../../test/render'
import { seedUpload, seedUser } from '../../mocks/db'

const HEADER = 'Date,Narration,Withdrawal,Deposit,Balance'
const csv = (lines, name = 'hdfc-oct-2026.csv') =>
  new File([[HEADER, ...lines].join('\n')], name, { type: 'text/csv' })
const ROWS = [
  '14/10/2026,UPI/SWIGGY/1,489.00,,81234.00',
  '15/10/2026,UPI/BIGBASKET/2,1200.00,,80034.00',
  '16/10/2026,UPI/IRCTC/3,2300.00,,77734.00',
]

async function chooseFile(ui, file) {
  await ui.upload(await screen.findByLabelText(/choose csv file/i), file)
}

describe('uploads', () => {
  it('shows an empty state before the first upload', async () => {
    renderApp('/uploads', { as: 'asha@example.com' })
    expect(await screen.findByText(/no uploads yet/i)).toBeInTheDocument()
  })

  it('uploads a CSV and shows inserted / duplicate / rejected counts', async () => {
    const { ui } = renderApp('/uploads', { as: 'asha@example.com' })
    await chooseFile(ui, csv([...ROWS, 'garbage']))

    const result = await screen.findByTestId('upload-result')
    expect(within(result).getByTestId('count-inserted')).toHaveTextContent('3')
    expect(within(result).getByTestId('count-duplicate')).toHaveTextContent('0')
    expect(within(result).getByTestId('count-rejected')).toHaveTextContent('1')
    expect(within(result).getByText(/line 5/i)).toBeInTheDocument()

    // It shows up in the upload list.
    expect(within(screen.getByTestId('upload-list')).getByText('hdfc-oct-2026.csv')).toBeInTheDocument()
  })

  it('reports duplicates when the same file is uploaded again', async () => {
    const { ui } = renderApp('/uploads', { as: 'asha@example.com' })
    await chooseFile(ui, csv(ROWS))
    await screen.findByTestId('upload-result')
    await chooseFile(ui, csv(ROWS))
    await waitFor(() =>
      expect(within(screen.getByTestId('upload-list')).getAllByText('hdfc-oct-2026.csv')).toHaveLength(2),
    )
    const result = screen.getByTestId('upload-result')
    expect(within(result).getByTestId('count-inserted')).toHaveTextContent('0')
    expect(within(result).getByTestId('count-duplicate')).toHaveTextContent('3')
  })

  it('rejects a non-CSV file before sending it', async () => {
    const { ui } = renderApp('/uploads', { as: 'asha@example.com' })
    await chooseFile(ui, new File(['%PDF'], 'statement.pdf', { type: 'application/pdf' }))
    expect(await screen.findByTestId('upload-error')).toHaveTextContent(/only csv/i)
    expect(screen.getByText(/no uploads yet/i)).toBeInTheDocument()
  })

  it('rejects a file over 5 MB before sending it', async () => {
    const { ui } = renderApp('/uploads', { as: 'asha@example.com' })
    const big = csv(ROWS, 'big.csv')
    Object.defineProperty(big, 'size', { value: 5 * 1024 * 1024 + 1 })
    await chooseFile(ui, big)
    expect(await screen.findByTestId('upload-error')).toHaveTextContent(/5 MB/i)
    expect(screen.getByText(/no uploads yet/i)).toBeInTheDocument()
  })

  it("shows the server's message for an unknown format", async () => {
    const { ui } = renderApp('/uploads', { as: 'asha@example.com' })
    await chooseFile(ui, new File(['Foo,Bar\n1,2'], 'weird.csv', { type: 'text/csv' }))
    expect(await screen.findByTestId('upload-error')).toHaveTextContent(/don't recognise this file's columns/i)
  })
})

describe('transactions table', () => {
  it('renders paise as rupees, debits and credits distinct', async () => {
    const user = seedUser('asha@example.com', { login: true })
    const upload = seedUpload(user.id, {
      filename: 'oct.csv',
      transactions: [
        { txn_date: '2026-10-14', merchant: 'Swiggy', category: 'Food delivery', amount_paise: 12345678, direction: 'debit' },
        { txn_date: '2026-10-01', merchant: 'Acme Corp', category: 'Salary', amount_paise: 500000, direction: 'credit' },
        { txn_date: '2026-10-02', merchant: null, description: 'NEFT/XYZ/ODD', category: 'Unidentified', amount_paise: 5, direction: 'debit' },
      ],
    })
    renderApp(`/uploads/${upload.id}`)
    const table = await screen.findByTestId('txn-table')
    const rows = await within(table).findAllByTestId('txn-row')
    expect(rows).toHaveLength(3)

    // Newest txn_date first.
    expect(rows[0]).toHaveTextContent('Swiggy')
    expect(rows[0]).toHaveTextContent('14 Oct 2026')
    expect(within(rows[0]).getByTestId('txn-amount')).toHaveTextContent('−₹1,23,456.78')
    expect(rows[0]).toHaveAttribute('data-direction', 'debit')

    expect(within(rows[1]).getByTestId('txn-amount')).toHaveTextContent('−₹0.05')
    expect(rows[1]).toHaveTextContent('NEFT/XYZ/ODD') // no merchant → raw description

    expect(within(rows[2]).getByTestId('txn-amount')).toHaveTextContent('+₹5,000.00')
    expect(rows[2]).toHaveAttribute('data-direction', 'credit')
  })

  it('pages through transactions', async () => {
    const user = seedUser('asha@example.com', { login: true })
    const transactions = Array.from({ length: 60 }, (_, i) => ({
      txn_date: `2026-09-${String((i % 28) + 1).padStart(2, '0')}`,
      merchant: `Shop ${i}`,
      category: 'Shopping',
      amount_paise: 1000 + i,
      direction: 'debit',
    }))
    const upload = seedUpload(user.id, { filename: 'sep.csv', transactions })
    const { ui } = renderApp(`/uploads/${upload.id}`)

    expect(await screen.findAllByTestId('txn-row')).toHaveLength(50)
    expect(screen.getByTestId('txn-page-info')).toHaveTextContent('Page 1 of 2 · 60 transactions')
    expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled()

    await ui.click(screen.getByRole('button', { name: /next/i }))
    await screen.findByText('Page 2 of 2 · 60 transactions')
    expect(screen.getAllByTestId('txn-row')).toHaveLength(10)
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled()
  })

  it('opens an upload from the list', async () => {
    const { ui } = renderApp('/uploads', { as: 'asha@example.com' })
    await ui.upload(await screen.findByLabelText(/choose csv file/i), csv(ROWS))
    await screen.findByTestId('upload-result')
    await ui.click(within(screen.getByTestId('upload-list')).getByText('hdfc-oct-2026.csv'))
    expect(await screen.findAllByTestId('txn-row')).toHaveLength(3)
  })

  it('shows an error state for an upload that is not yours', async () => {
    renderApp('/uploads/9999', { as: 'asha@example.com' })
    expect(await screen.findByTestId('txn-error')).toHaveTextContent(/not found/i)
  })

  it('marks debits that do not count as spend', async () => {
    const user = seedUser('asha@example.com', { login: true })
    const upload = seedUpload(user.id, {
      transactions: [
        { txn_date: '2026-10-05', merchant: 'Zerodha', category: 'Investments', amount_paise: 1000000, direction: 'debit' },
      ],
    })
    renderApp(`/uploads/${upload.id}`)
    const row = await screen.findByTestId('txn-row')
    expect(row).toHaveTextContent(/not spend/i)
  })
})
