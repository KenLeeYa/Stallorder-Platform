export function catalogDesktopEditButton(page, productName) {
  return page.getByRole('table', { name: '授權組織商品清單', exact: true })
    .getByRole('row').filter({ has: page.getByText(productName, { exact: true }) })
    .getByRole('button', { name: '編輯', exact: true });
}

export function catalogMobileEditButton(page, productName) {
  return page.getByRole('button', { name: `編輯 ${productName}`, exact: true }).filter({ visible: true });
}
