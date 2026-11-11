import { expect, test } from '@playwright/test'

/*
 * The org home, /: a card for each element, one for each tool, the build page, and a footer of
 * links; and the build page links the skill's page, which has no card of its own.
 */

test('the home page links to the build page, and the build page to the skill’s page, and both answer', async ({ page, request }) => {
  await page.goto('/')
  await expect(page.getByRole('region', { name: 'Web components' }).getByRole('link', { name: 'pdfjs-viewer', exact: true })).toHaveAttribute('href', '/pdfjs-viewer/')
  await expect(page.getByRole('region', { name: 'Tools' }).getByRole('link', { name: 'Build an H5P activity', exact: true })).toHaveAttribute('href', '/h5p/build/')
  await expect(page.getByRole('navigation', { name: 'Useful links' }).getByRole('link', { name: 'pdfjs-viewer on npm' })).toHaveAttribute('href', 'https://www.npmjs.com/package/@missing-elements/pdfjs-viewer')
  expect((await request.get('/h5p/build/')).ok()).toBe(true)

  await page.goto('/h5p/build/')
  await expect(page.getByRole('link', { name: "the h5p-author skill's page" })).toHaveAttribute('href', '/h5p/skill/')
  expect((await request.get('/h5p/skill/')).ok()).toBe(true)
})
